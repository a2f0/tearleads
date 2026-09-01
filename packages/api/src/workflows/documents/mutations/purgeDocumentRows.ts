import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessEventDependencyProjection,
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  accessManifests,
  attachmentBindings,
  blobs,
  documentAttachmentAuditEvents,
  documentAuditCheckpoints,
  documentAuditEntries,
  documentContainerLinks,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documentContentWriteHeaders,
  documentManifestObservations,
  documents,
  documentUpdateAuditEvents,
  documentUpdateSpans,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { wallClockNowExpression } from "../../../utils/sqlDialect";
import { DocumentMutationError } from "./errors";

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

// Attachment bindings (active and detached history) for this document, then a
// soft-delete of any blob this purge orphaned. The blob rows, bytes, audit
// objects, and key material are RETAINED — only `dereferencedAt` is stamped, so
// a later GC sweep can re-check reachability (a bind racing this purge under
// READ COMMITTED is invisible here) and hard-delete only truly-unreachable
// blobs. `IS NULL` keeps an already-dereferenced blob's original timestamp.
async function deleteDocumentAttachmentRows(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly orphanedBlobIds: readonly string[];
}): Promise<void> {
  await input.executor
    .delete(attachmentBindings)
    .where(eq(attachmentBindings.documentId, input.documentId));
  if (input.orphanedBlobIds.length > 0) {
    await input.executor
      .update(blobs)
      .set({
        // Start the grace period only after the caller has acquired the
        // document and blob reachability locks. PostgreSQL's transaction clock
        // is fixed at BEGIN, so this must use the statement wall clock.
        dereferencedAt: wallClockNowExpression(),
        reclaimAttemptedAt: null,
      })
      .where(
        and(
          inArray(blobs.id, [...input.orphanedBlobIds]),
          isNull(blobs.dereferencedAt),
        ),
      );
  }
}

// Retain signed access history so every device can verify the terminal purge
// event after the mutable document row and encrypted content are gone. Only the
// live-head pointer is removed; manifests, events, and their derived
// projections remain append-only proof material.
async function deleteDocumentAccessHead(
  documentId: string,
  executor: DatabaseTransaction,
): Promise<void> {
  await executor
    .delete(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, "document"),
        eq(accessManifestHeads.objectId, documentId),
      ),
    );
}

async function deleteDocumentAccessHistory(
  documentId: string,
  executor: DatabaseTransaction,
): Promise<void> {
  await executor
    .delete(documentManifestObservations)
    .where(eq(documentManifestObservations.documentId, documentId));
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
    .delete(accessManifestPrincipalHeadProjection)
    .where(
      and(
        eq(accessManifestPrincipalHeadProjection.objectKind, "document"),
        eq(accessManifestPrincipalHeadProjection.objectId, documentId),
      ),
    );
  await executor
    .delete(accessEvents)
    .where(
      and(
        eq(accessEvents.objectKind, "document"),
        eq(accessEvents.objectId, documentId),
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

export async function deleteDocumentRows(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly orphanedBlobIds: readonly string[];
  readonly retainAccessHistory: boolean;
}): Promise<void> {
  const { documentId, executor } = input;

  await deleteDocumentAuditRows(documentId, executor);
  await deleteDocumentContentRows(documentId, executor);
  await deleteDocumentAttachmentRows(input);
  await deleteDocumentAccessHead(documentId, executor);
  if (!input.retainAccessHistory) {
    await deleteDocumentAccessHistory(documentId, executor);
  }

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
