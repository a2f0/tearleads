import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import {
  attachmentBindings,
  containerDocumentSyncTombstones,
  containerMetadataDocuments,
  documentContainerLinks,
  documents,
} from "@symcrypt/api-shared/schema";
import type { DocumentPurgeRequest } from "@symcrypt/validators/request";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { lockAccessManifestHeadsForUpdate } from "../../../access/read/accessManifestStore";
import { storeVerifiedAccessEventInTransaction } from "../../../access/write/accessManifestStore";
import { projectionVerifiedAccessEventRecord } from "../../../keyingProjectionRecords";
import { assertOrganizationCanSync } from "../../billing/organizationSyncEligibility";
import { lockBlobMutationRows } from "../../blobs/mutations/blobMutationLocks";
import {
  ContainerWriterProjectionError,
  resolveContainerAccessProjection,
} from "../../containers/writerProjection";
import { lockOrganizationReadModelHeadForUpdateInTransaction } from "../../organizations/readModelChanges";
import { assertRosterProfileDocumentUnbound } from "../../organizations/rosterProfileBindingInvariant";
import { loadDocumentPurgeProofMaterial } from "../writerProjectionPurgeProof";
import { DocumentMutationError, toMutationError } from "./errors";
import { deleteDocumentRows } from "./purgeDocumentRows";
import { verifyDocumentPurgeRequest } from "./shared/purgeVerification";
import type { PurgeDocumentInput, PurgeDocumentWorkflowResult } from "./types";

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

// Collect blob ids still ACTIVE on another document, so purging this document
// never reclaims bytes another live projection needs. Detached bindings and
// audit events retain metadata only and deliberately do not keep bytes live.
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
        isNull(attachmentBindings.detachedAt),
      ),
    );
  for (const binding of otherBindings) {
    referenced.add(binding.blobId);
  }

  return referenced;
}

// Blobs can be shared: a single blob may be bound to several documents, and a
// document's own history can hold detached bindings to a blob it replaced.
// Purging this document orphans a blob when no active binding remains anywhere.
// Returns the ids of the blobs this purge orphans;
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

  // Attachment mutations take the document head before these same blob locks.
  // The purge already holds that head exclusively, so locking every candidate
  // now makes reachability stable through the binding delete below and keeps
  // the global document -> blob -> binding order.
  await lockBlobMutationRows({
    blobIds: candidateBlobIds,
    executor: input.executor,
  });

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

async function resolveLockedPurgeAuthorization(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly userId: string;
}): Promise<{ readonly containerId: string; readonly organizationId: string }> {
  await assertDocumentIsPurgeable(input);
  const candidateContainerId = await resolveSolePurgeContainerId(input);
  const candidateOrganizationId = await authorizePurge({
    containerId: candidateContainerId,
    executor: input.executor,
    userId: input.userId,
  });
  const organizationHeadLocked =
    await lockOrganizationReadModelHeadForUpdateInTransaction(
      input.executor,
      candidateOrganizationId,
    );
  if (!organizationHeadLocked) {
    throw new Error("Organization read-model cursor head is missing");
  }
  await lockAccessManifestHeadsForUpdate(
    "document",
    [input.documentId],
    input.executor,
  );
  await assertDocumentIsPurgeable(input);
  const containerId = await resolveSolePurgeContainerId(input);
  const organizationId = await authorizePurge({
    containerId,
    executor: input.executor,
    userId: input.userId,
  });
  if (organizationId !== candidateOrganizationId) {
    throw new DocumentMutationError("Document organization mismatch", 409);
  }
  return { containerId, organizationId };
}

async function purgeDocumentWithExecutor(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly request: DocumentPurgeRequest;
  readonly userId: string;
}): Promise<PurgeDocumentWorkflowResult> {
  // Resolve the candidate organization before taking locks, then follow the
  // organization -> document order shared with link-set and roster mutations.
  // Every authorization/read below is repeated under those locks, so a
  // concurrent relink, bind, or purge cannot make the preliminary view
  // authoritative.
  const { containerId, organizationId } = await resolveLockedPurgeAuthorization(
    {
      documentId: input.documentId,
      executor: input.executor,
      userId: input.userId,
    },
  );
  await assertRosterProfileDocumentUnbound({
    documentId: input.documentId,
    executor: input.executor,
  });
  await assertOrganizationCanSync(input.executor, organizationId, input.userId);

  const verifiedPurge = await verifyDocumentPurgeRequest({
    documentId: input.documentId,
    executor: input.executor,
    fingerprint: input.fingerprint,
    request: input.request,
    userId: input.userId,
  });
  const authorizingContainerManifestHashes =
    verifiedPurge.authorizingContainerPath.map(
      (manifest) => manifest.manifestHash,
    );
  if (authorizingContainerManifestHashes.length === 0) {
    throw new DocumentMutationError(
      "Document purge authorization path is missing",
      409,
    );
  }
  const proofMaterial = await loadDocumentPurgeProofMaterial({
    authorizingContainerManifestHashes,
    documentManifestHash: verifiedPurge.documentManifest.manifestHash,
    executor: input.executor,
  });

  const orphanedBlobIds = await resolveOrphanedBlobIds({
    documentId: input.documentId,
    executor: input.executor,
  });
  const purgedAt = new Date();

  await storeVerifiedAccessEventInTransaction(
    verifiedPurge.event,
    input.executor,
  );
  await deleteDocumentRows({
    documentId: input.documentId,
    executor: input.executor,
    orphanedBlobIds,
    retainAccessHistory: true,
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
      authorizingContainerCheckpointHeads:
        proofMaterial.authorizingContainerPath,
      authorizingContainerPath: proofMaterial.authorizingContainerPath,
      documentContainerManifestHistory:
        proofMaterial.authorizingContainerManifestHistory,
      documentId: input.documentId,
      documentManifest: {
        manifest: proofMaterial.documentManifest.manifest,
        manifestHash: proofMaterial.documentManifest.manifestHash,
        state: proofMaterial.documentManifest.state,
      },
      documentManifestPredecessors: [],
      purgeEvent: projectionVerifiedAccessEventRecord(verifiedPurge.event),
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
  input: PurgeDocumentInput,
): Promise<PurgeDocumentWorkflowResult> {
  try {
    return await db.transaction((tx) =>
      purgeDocumentWithExecutor({
        documentId: input.documentId,
        executor: tx,
        fingerprint: input.fingerprint,
        request: input.request,
        userId: input.userId,
      }),
    );
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
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
 * Runs inside the caller's transaction. Any orphaned blob starts its grace
 * period from the database wall clock after the reachability locks below have
 * been acquired; time spent waiting for those locks must not consume it.
 */
export async function teardownContainerMetadataDocument(input: {
  readonly containerId: string;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  // Same serialization requirement as purgeDocumentWithExecutor: the metadata
  // document's rows are deleted below, so an in-flight sync write on it must
  // commit or abort before this teardown reads what to delete. Callers that
  // lock or delete container rows in the same transaction must take THIS head
  // lock first (deleteContainer does) — sync writers hold the head FOR UPDATE
  // and then update container rows, so row-then-head ordering here would
  // deadlock.
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
    documentId: input.documentId,
    executor: input.executor,
    orphanedBlobIds,
    retainAccessHistory: false,
  });
}
