import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessEventDependencyProjection,
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifests,
  attachmentBindings,
  blobAuditObjects,
  blobs,
  containerDocumentSyncTombstones,
  containerMetadataDocuments,
  documentAttachmentAuditEvents,
  documentAuditCheckpoints,
  documentAuditEntries,
  documentContainerLinks,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documentContentWriteHeaders,
  documents,
  documentUpdateAuditEvents,
  documentUpdateSpans,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import type { DocumentPurgeResponse } from "@tearleads/validators/response";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { ApiServiceRuntime } from "../../../services/runtime";
import { readExternalBlobBytesRef } from "../../../utils/blobStageRecords";
import {
  ContainerWriterProjectionError,
  resolveContainerAccessProjection,
} from "../../containers/writerProjection";
import { DocumentMutationError } from "./errors";

type BlobByteDeletion = {
  readonly blobId: string;
  readonly storageKey: string;
};

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

  const [containerId] = containerIds;
  if (!containerId) {
    throw new DocumentMutationError(
      "Document is not linked to any container",
      409,
    );
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
}): Promise<void> {
  try {
    await resolveContainerAccessProjection({
      containerId: input.containerId,
      executor: input.executor,
      minimumAccessLevel: "write",
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof ContainerWriterProjectionError) {
      throw toDocumentMutationError(error);
    }
    throw error;
  }
}

// Blobs can be shared: a single blob may have active attachment bindings on
// several documents. We may only delete a blob's bytes when purging this
// document removes its last active binding anywhere. Returns the storage keys
// safe to delete from the object store.
async function resolveReclaimableBlobBytes(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
}): Promise<BlobByteDeletion[]> {
  const activeBindings = await input.executor
    .select({ blobId: attachmentBindings.blobId })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.documentId, input.documentId),
        isNull(attachmentBindings.detachedAt),
      ),
    );
  const candidateBlobIds = [
    ...new Set(activeBindings.map((binding) => binding.blobId)),
  ];
  if (candidateBlobIds.length === 0) {
    return [];
  }

  const bindingsElsewhere = await input.executor
    .select({ blobId: attachmentBindings.blobId })
    .from(attachmentBindings)
    .where(
      and(
        inArray(attachmentBindings.blobId, candidateBlobIds),
        ne(attachmentBindings.documentId, input.documentId),
        isNull(attachmentBindings.detachedAt),
      ),
    );
  const sharedBlobIds = new Set(
    bindingsElsewhere.map((binding) => binding.blobId),
  );
  const orphanedBlobIds = candidateBlobIds.filter(
    (blobId) => !sharedBlobIds.has(blobId),
  );
  if (orphanedBlobIds.length === 0) {
    return [];
  }

  const blobRows = await input.executor
    .select({ id: blobs.id, encryptedBytes: blobs.encryptedBytes })
    .from(blobs)
    .where(inArray(blobs.id, orphanedBlobIds));

  return blobRows.flatMap((row) => {
    const externalRef = readExternalBlobBytesRef(row.encryptedBytes);
    // Legacy inline blobs store bytes in the row itself; deleting the row (done
    // below) reclaims them, so there is no object-store key to delete.
    return externalRef
      ? [{ blobId: row.id, storageKey: externalRef.storageKey }]
      : [];
  });
}

// Audit event detail tables reference documentAuditEntries(id); clear them
// before the entries they depend on, then the checkpoint chain.
async function deleteDocumentAuditRows(
  documentId: string,
  executor: DatabaseTransaction,
): Promise<void> {
  const auditEntryRows = await executor
    .select({ id: documentAuditEntries.id })
    .from(documentAuditEntries)
    .where(eq(documentAuditEntries.documentId, documentId));
  const auditEntryIds = auditEntryRows.map((row) => row.id);
  if (auditEntryIds.length > 0) {
    await executor
      .delete(documentUpdateAuditEvents)
      .where(inArray(documentUpdateAuditEvents.auditEntryId, auditEntryIds));
    await executor
      .delete(documentAttachmentAuditEvents)
      .where(
        inArray(documentAttachmentAuditEvents.auditEntryId, auditEntryIds),
      );
  }
  await executor
    .delete(documentAuditEntries)
    .where(eq(documentAuditEntries.documentId, documentId));
  await executor
    .delete(documentAuditCheckpoints)
    .where(eq(documentAuditCheckpoints.documentId, documentId));
}

// Content-key targets reference documentContentKeyEpochs(id); the loro update
// payloads and write headers are independent.
async function deleteDocumentContentRows(
  documentId: string,
  executor: DatabaseTransaction,
): Promise<void> {
  const epochRows = await executor
    .select({ id: documentContentKeyEpochs.id })
    .from(documentContentKeyEpochs)
    .where(eq(documentContentKeyEpochs.documentId, documentId));
  const epochIds = epochRows.map((row) => row.id);
  if (epochIds.length > 0) {
    await executor
      .delete(documentContentKeyTargets)
      .where(
        inArray(documentContentKeyTargets.documentContentKeyEpochId, epochIds),
      );
  }
  await executor
    .delete(documentContentKeyEpochs)
    .where(eq(documentContentKeyEpochs.documentId, documentId));
  await executor
    .delete(documentContentWriteHeaders)
    .where(eq(documentContentWriteHeaders.documentId, documentId));
  await executor
    .delete(documentUpdateSpans)
    .where(eq(documentUpdateSpans.documentId, documentId));
  await executor
    .delete(documentUpdates)
    .where(eq(documentUpdates.documentId, documentId));
}

// Attachment bindings (active and detached history) for this document, then
// any blob rows whose last active binding we just removed.
async function deleteDocumentAttachmentRows(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly orphanedBlobIds: readonly string[];
}): Promise<void> {
  await input.executor
    .delete(attachmentBindings)
    .where(eq(attachmentBindings.documentId, input.documentId));
  if (input.orphanedBlobIds.length > 0) {
    const orphanedBlobIds = [...input.orphanedBlobIds];
    await input.executor
      .delete(blobAuditObjects)
      .where(inArray(blobAuditObjects.blobId, orphanedBlobIds));
    await input.executor
      .delete(blobs)
      .where(inArray(blobs.id, orphanedBlobIds));
  }
}

// Signed access history and its projections for this document.
async function deleteDocumentAccessHistory(
  documentId: string,
  executor: DatabaseTransaction,
): Promise<void> {
  await executor
    .delete(accessEventDependencyProjection)
    .where(
      and(
        eq(accessEventDependencyProjection.objectKind, "document"),
        eq(accessEventDependencyProjection.objectId, documentId),
      ),
    );
  await executor
    .delete(accessManifestDocumentLinkProjection)
    .where(eq(accessManifestDocumentLinkProjection.documentId, documentId));
  await executor
    .delete(accessEvents)
    .where(
      and(
        eq(accessEvents.objectKind, "document"),
        eq(accessEvents.objectId, documentId),
      ),
    );
  await executor
    .delete(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, "document"),
        eq(accessManifestHeads.objectId, documentId),
      ),
    );
  await executor
    .delete(accessManifests)
    .where(
      and(
        eq(accessManifests.objectKind, "document"),
        eq(accessManifests.objectId, documentId),
      ),
    );
}

async function deleteDocumentRows(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly orphanedBlobIds: readonly string[];
}): Promise<void> {
  const { documentId, executor } = input;

  await deleteDocumentAuditRows(documentId, executor);
  await deleteDocumentContentRows(documentId, executor);
  await deleteDocumentAttachmentRows(input);
  await deleteDocumentAccessHistory(documentId, executor);

  // Current link projection, then the document row itself.
  await executor
    .delete(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, documentId));
  const [deleted] = await executor
    .delete(documents)
    .where(eq(documents.id, documentId))
    .returning({ id: documents.id });
  if (!deleted) {
    throw new DocumentMutationError("Document not found", 404);
  }
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
}): Promise<DocumentPurgeResponse> {
  await assertDocumentIsPurgeable({
    documentId: input.documentId,
    executor: input.executor,
  });
  const containerId = await resolveSolePurgeContainerId({
    documentId: input.documentId,
    executor: input.executor,
  });
  await authorizePurge({
    containerId,
    executor: input.executor,
    userId: input.userId,
  });

  const reclaimableBlobBytes = await resolveReclaimableBlobBytes({
    documentId: input.documentId,
    executor: input.executor,
  });
  const purgedAt = new Date();

  await deleteDocumentRows({
    documentId: input.documentId,
    executor: input.executor,
    orphanedBlobIds: reclaimableBlobBytes.map((deletion) => deletion.blobId),
  });
  await writePurgeTombstone({
    containerId,
    documentId: input.documentId,
    executor: input.executor,
    updatedAt: purgedAt,
  });

  return {
    documentId: input.documentId,
    purgedAt: purgedAt.toISOString(),
    reclaimedBlobStorageKeys: reclaimableBlobBytes.map(
      (deletion) => deletion.storageKey,
    ),
  };
}

export async function purgeDocument(
  runtime: ApiServiceRuntime,
  input: {
    readonly documentId: string;
    readonly userId: string;
  },
): Promise<DocumentPurgeResponse> {
  const response = await runtime.db.transaction((tx) =>
    purgeDocumentWithExecutor({
      documentId: input.documentId,
      executor: tx,
      userId: input.userId,
    }),
  );

  // Object-store bytes are deleted only after the transaction commits, so a
  // rollback never leaves dangling references and a post-commit storage failure
  // only leaks bytes (reclaimable later) rather than corrupting state.
  for (const storageKey of response.reclaimedBlobStorageKeys) {
    try {
      await runtime.blobObjectStore.deleteObject(storageKey);
    } catch {
      // Best-effort: the blob row is already gone, so the bytes are orphaned
      // and safe to leave for a future sweep. Do not fail the purge.
    }
  }

  return response;
}
