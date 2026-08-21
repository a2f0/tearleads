import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import {
  attachmentBindings,
  containerDocumentSyncTombstones,
  containerMetadataDocuments,
  documentAttachmentAuditEvents,
  documentAuditEntries,
  documentContainerLinks,
  documents,
} from "@symcrypt/api-shared/schema";
import { and, eq, inArray, ne } from "drizzle-orm";
import { lockAccessManifestHeadsForUpdate } from "../../../access/read/accessManifestStore";
import { assertOrganizationCanSync } from "../../billing/organizationSyncEligibility";
import {
  ContainerWriterProjectionError,
  resolveContainerAccessProjection,
} from "../../containers/writerProjection";
import { DocumentMutationError } from "./errors";
import { deleteDocumentRows } from "./purgeDocumentRows";
import type { PurgeDocumentWorkflowResult } from "./types";

function toDocumentMutationError(
  error: ContainerWriterProjectionError,
): DocumentMutationError {
  return new DocumentMutationError(error.message, error.status);
}

// The single container a purgeable document is linked to. Purge is only allowed
// for a document whose current link set has exactly one container (its trash);
// a document still linked elsewhere must be unlinked from those containers
// first. The server enforces cardinality here — it cannot identify "trash"
// itself because the trash system slot is an identity-secret HMAC the API never
// holds (see deriveContainerSystemSlot), so the UI restricts the action to the
// trash container while the server guarantees the structural invariant.
async function resolveSolePurgeContainerId(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
}): Promise<string> {
  const linkRows = await input.executor
    .select({ containerId: documentContainerLinks.containerId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, input.documentId));
  const containerIds = [...new Set(linkRows.map((row) => row.containerId))];

  if (containerIds.length === 0) {
    throw new DocumentMutationError(
      "Document is not linked to any container",
      409,
    );
  }
  if (containerIds.length > 1) {
    throw new DocumentMutationError(
      "Document must be linked to a single container before it can be purged",
      409,
    );
  }

  // Exactly one element after the guards above; the check only narrows types.
  const [containerId] = containerIds;
  if (!containerId) {
    throw new Error("unreachable: containerIds has exactly one element");
  }

  return containerId;
}

async function assertDocumentIsPurgeable(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  const [document] = await input.executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!document) {
    throw new DocumentMutationError("Document not found", 404);
  }

  const [metadataBinding] = await input.executor
    .select({ documentId: containerMetadataDocuments.documentId })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.documentId, input.documentId))
    .limit(1);
  if (metadataBinding) {
    throw new DocumentMutationError(
      "Container metadata documents cannot be purged",
      409,
    );
  }
}

async function authorizePurge(input: {
  readonly containerId: string;
  readonly executor: DatabaseTransaction;
  readonly userId: string;
}): Promise<string> {
  try {
    const access = await resolveContainerAccessProjection({
      containerId: input.containerId,
      executor: input.executor,
      minimumAccessLevel: "write",
      userId: input.userId,
    });
    const targetManifest = access.verifiedPath.at(-1);
    if (!targetManifest) {
      throw new DocumentMutationError("Container not found", 404);
    }
    return targetManifest.state.organizationId;
  } catch (error) {
    if (error instanceof ContainerWriterProjectionError) {
      throw toDocumentMutationError(error);
    }
    throw error;
  }
}

// Collect every blobId still referenced by some OTHER document, so purging this
// document never reclaims a blob another document still needs. "Referenced"
// spans more than active bindings:
//   - any binding on another document, ACTIVE OR DETACHED — a detached binding
//     is retained history that still points at the blob; and
//   - any attachment audit event on another document that names the blob as its
//     blobId or previousBlobId — the immutable audit trail references it.
// `blobAuditObjects` itself is a single per-blob row (keyed by blobId, no
// documentId), so it is not a cross-document signal; we delete it for a blob
// only once that blob is proven orphaned below.
async function resolveBlobIdsReferencedByOtherDocuments(input: {
  readonly candidateBlobIds: readonly string[];
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
}): Promise<Set<string>> {
  const candidateBlobIds = [...input.candidateBlobIds];
  const referenced = new Set<string>();

  const otherBindings = await input.executor
    .select({ blobId: attachmentBindings.blobId })
    .from(attachmentBindings)
    .where(
      and(
        inArray(attachmentBindings.blobId, candidateBlobIds),
        ne(attachmentBindings.documentId, input.documentId),
      ),
    );
  for (const binding of otherBindings) {
    referenced.add(binding.blobId);
  }

  // Attachment audit events live on `documentAttachmentAuditEvents` and reach
  // their owning document through `documentAuditEntries.documentId`. A blob
  // named as blobId or previousBlobId by another document's history must be
  // retained so that history keeps resolving.
  const otherAuditEvents = await input.executor
    .select({
      blobId: documentAttachmentAuditEvents.blobId,
      previousBlobId: documentAttachmentAuditEvents.previousBlobId,
    })
    .from(documentAttachmentAuditEvents)
    .innerJoin(
      documentAuditEntries,
      eq(documentAuditEntries.id, documentAttachmentAuditEvents.auditEntryId),
    )
    .where(ne(documentAuditEntries.documentId, input.documentId));
  const candidateSet = new Set(candidateBlobIds);
  for (const event of otherAuditEvents) {
    if (event.blobId && candidateSet.has(event.blobId)) {
      referenced.add(event.blobId);
    }
    if (event.previousBlobId && candidateSet.has(event.previousBlobId)) {
      referenced.add(event.previousBlobId);
    }
  }

  return referenced;
}

// Blobs can be shared: a single blob may be bound to several documents, and a
// document's own history can hold detached bindings to a blob it replaced.
// Purging this document orphans a blob only when it removes the last reference
// to that blob anywhere (across all documents, active or detached bindings, and
// attachment audit history). Returns the ids of the blobs this purge orphans;
// the caller soft-deletes them (retaining bytes) rather than hard-deleting,
// because a concurrent bind to a shared blob is a phantom this scan cannot see
// under READ COMMITTED — a later GC sweep re-checks reachability before
// reclaiming any bytes.
async function resolveOrphanedBlobIds(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
}): Promise<string[]> {
  // Candidates are every blob this document references, including via DETACHED
  // bindings left behind by replace/detach — those become orphaned once this
  // document (their last referrer) is purged.
  const ownBindings = await input.executor
    .select({ blobId: attachmentBindings.blobId })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.documentId, input.documentId));
  const candidateBlobIds = [
    ...new Set(ownBindings.map((binding) => binding.blobId)),
  ];
  if (candidateBlobIds.length === 0) {
    return [];
  }

  const referencedElsewhere = await resolveBlobIdsReferencedByOtherDocuments({
    candidateBlobIds,
    documentId: input.documentId,
    executor: input.executor,
  });
  return candidateBlobIds.filter((blobId) => !referencedElsewhere.has(blobId));
}

async function writePurgeTombstone(input: {
  readonly containerId: string;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly updatedAt: Date;
}): Promise<void> {
  await input.executor
    .insert(containerDocumentSyncTombstones)
    .values({
      containerId: input.containerId,
      documentId: input.documentId,
      updatedAt: input.updatedAt,
    })
    .onConflictDoUpdate({
      target: [
        containerDocumentSyncTombstones.containerId,
        containerDocumentSyncTombstones.documentId,
      ],
      set: { updatedAt: input.updatedAt },
    });
}

async function purgeDocumentWithExecutor(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly userId: string;
}): Promise<PurgeDocumentWorkflowResult> {
  // Take the document manifest-head lock BEFORE any read or delete, mirroring
  // the link-set mutation path. Sync writers hold this head FOR SHARE while
  // inserting content rows, so without it a purge interleaving with an
  // in-flight sync write silently skips the writer's uncommitted rows
  // (invisible under READ COMMITTED), commits the head/document delete after
  // the writer commits, and strands orphaned update rows that permanently
  // wedge any re-create of the same client-chosen document id.
  await lockAccessManifestHeadsForUpdate(
    "document",
    [input.documentId],
    input.executor,
  );
  await assertDocumentIsPurgeable({
    documentId: input.documentId,
    executor: input.executor,
  });
  const containerId = await resolveSolePurgeContainerId({
    documentId: input.documentId,
    executor: input.executor,
  });
  const organizationId = await authorizePurge({
    containerId,
    executor: input.executor,
    userId: input.userId,
  });
  await assertOrganizationCanSync(input.executor, organizationId, input.userId);

  const orphanedBlobIds = await resolveOrphanedBlobIds({
    documentId: input.documentId,
    executor: input.executor,
  });
  const purgedAt = new Date();

  await deleteDocumentRows({
    dereferencedAt: purgedAt,
    documentId: input.documentId,
    executor: input.executor,
    orphanedBlobIds,
  });
  await writePurgeTombstone({
    containerId,
    documentId: input.documentId,
    executor: input.executor,
    updatedAt: purgedAt,
  });

  // Orphaned blobs are soft-deleted (bytes retained), so nothing is reclaimed
  // synchronously; the GC sweep reclaims object-store bytes after re-checking
  // reachability. Always empty until that sweep exists.
  return {
    containerIds: [containerId],
    response: {
      documentId: input.documentId,
      purgedAt: purgedAt.toISOString(),
      reclaimedBlobStorageKeys: [],
    },
  };
}

// Hard-deletes the document and its per-document rows in one transaction, and
// SOFT-deletes (stamps `dereferencedAt`, retaining bytes) any blob the purge
// orphaned. Blob bytes are intentionally never reclaimed here: a bind racing
// this purge under READ COMMITTED is a phantom the reachability scan cannot
// see, so hard-deleting bytes synchronously could destroy a blob another
// document just re-referenced. A GC sweep reclaims dereferenced blobs later
// after re-checking reachability, so `reclaimedBlobStorageKeys` is empty.
export async function runPurgeDocumentWorkflow(
  db: ApiDatabase,
  input: {
    readonly documentId: string;
    readonly userId: string;
  },
): Promise<PurgeDocumentWorkflowResult> {
  return db.transaction((tx) =>
    purgeDocumentWithExecutor({
      documentId: input.documentId,
      executor: tx,
      userId: input.userId,
    }),
  );
}

/**
 * Tear down a container's OWN metadata document as part of deleting the
 * container. This deliberately bypasses the purge workflow: assertDocumentIsPurgeable
 * hard-rejects metadata documents, but the container itself is being deleted so
 * its metadata document must go with it. It also removes the
 * containerMetadataDocuments binding that the normal document teardown never
 * touches. No purge tombstone is written — metadata documents are withheld from
 * client document discovery, so the per-user container tombstone that
 * deleteContainer already writes is the peer signal.
 *
 * The metadata DOCUMENT rows only exist when the container was created via the
 * composite /containers/with-metadata-document path; a container created via the
 * plain /containers path carries only the binding and a manifest pointer, with
 * no document rows. Tear the document down only when it exists.
 *
 * Runs inside the caller's transaction. `dereferencedAt` is the container
 * deletion's timestamp, threaded through so any dereferenced blob is stamped at
 * the same logical time as the container tombstone (one clock read per delete).
 */
export async function teardownContainerMetadataDocument(input: {
  readonly containerId: string;
  readonly dereferencedAt: Date;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  // Same serialization requirement as purgeDocumentWithExecutor: the metadata
  // document's rows are deleted below, so an in-flight sync write on it must
  // commit or abort before this teardown reads what to delete. Callers that
  // lock or delete container rows in the same transaction must take THIS head
  // lock first (deleteContainer does) — sync holds the head FOR SHARE and then
  // updates container rows, so row-then-head ordering here would deadlock.
  // Re-locking an already-held head is a no-op.
  await lockAccessManifestHeadsForUpdate(
    "document",
    [input.documentId],
    input.executor,
  );
  await input.executor
    .delete(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.containerId, input.containerId));

  const [metadataDocument] = await input.executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!metadataDocument) {
    return;
  }

  const orphanedBlobIds = await resolveOrphanedBlobIds({
    documentId: input.documentId,
    executor: input.executor,
  });
  await deleteDocumentRows({
    dereferencedAt: input.dereferencedAt,
    documentId: input.documentId,
    executor: input.executor,
    orphanedBlobIds,
  });
}
