import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifests,
  attachmentBindings,
  blobs,
  documentBaselines,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documentContentWriteHeaders,
  documentInlineRekeyCommits,
  documentManifestObservations,
  documents,
  documentUpdateSpans,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { wallClockNowExpression } from "../../../utils/sqlDialect";
import { DocumentMutationError } from "./errors";

// Content-key targets reference documentContentKeyEpochs(id); the loro update
// payloads, write headers, and baseline markers are independent.
async function deleteDocumentContentRows(
  documentIds: readonly string[],
  executor: DatabaseTransaction,
): Promise<void> {
  await executor.delete(documentContentKeyTargets).where(
    inArray(
      documentContentKeyTargets.documentContentKeyEpochId,
      executor
        .select({ id: documentContentKeyEpochs.id })
        .from(documentContentKeyEpochs)
        .where(inArray(documentContentKeyEpochs.documentId, [...documentIds])),
    ),
  );
  await executor
    .delete(documentContentKeyEpochs)
    .where(inArray(documentContentKeyEpochs.documentId, [...documentIds]));
  await executor
    .delete(documentContentWriteHeaders)
    .where(inArray(documentContentWriteHeaders.documentId, [...documentIds]));
  await executor
    .delete(documentInlineRekeyCommits)
    .where(inArray(documentInlineRekeyCommits.documentId, [...documentIds]));
  await executor
    .delete(documentBaselines)
    .where(inArray(documentBaselines.documentId, [...documentIds]));
  await executor
    .delete(documentUpdateSpans)
    .where(inArray(documentUpdateSpans.documentId, [...documentIds]));
  await executor
    .delete(documentUpdates)
    .where(inArray(documentUpdates.documentId, [...documentIds]));
}

// Attachment bindings (active and detached history) for these documents, then
// a soft-delete of any blob this purge orphaned. The blob rows, bytes, audit
// objects, and key material are RETAINED — only `dereferencedAt` is stamped, so
// a later GC sweep can re-check reachability (a bind racing this purge under
// READ COMMITTED is invisible here) and hard-delete only truly-unreachable
// blobs. `IS NULL` keeps an already-dereferenced blob's original timestamp.
async function deleteDocumentAttachmentRows(input: {
  readonly documentIds: readonly string[];
  readonly executor: DatabaseTransaction;
  readonly orphanedBlobIds: readonly string[];
}): Promise<void> {
  await input.executor
    .delete(attachmentBindings)
    .where(inArray(attachmentBindings.documentId, [...input.documentIds]));
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
async function deleteDocumentAccessHeads(
  documentIds: readonly string[],
  executor: DatabaseTransaction,
): Promise<void> {
  await executor
    .delete(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, "document"),
        inArray(accessManifestHeads.objectId, [...documentIds]),
      ),
    );
}

// Document manifests commit to an empty `referencedPrincipalHeads` list, and
// `insertAccessManifestPrincipalProjection` refuses a document row, so no
// principal-head projection row names a document and none is deleted here.
async function deleteDocumentAccessHistory(
  documentIds: readonly string[],
  executor: DatabaseTransaction,
): Promise<void> {
  await executor
    .delete(documentManifestObservations)
    .where(inArray(documentManifestObservations.documentId, [...documentIds]));
  await executor
    .delete(accessManifestDocumentLinkProjection)
    .where(
      inArray(accessManifestDocumentLinkProjection.documentId, [
        ...documentIds,
      ]),
    );
  await executor
    .delete(accessEvents)
    .where(
      and(
        eq(accessEvents.objectKind, "document"),
        inArray(accessEvents.objectId, [...documentIds]),
      ),
    );
  await executor
    .delete(accessManifests)
    .where(
      and(
        eq(accessManifests.objectKind, "document"),
        inArray(accessManifests.objectId, [...documentIds]),
      ),
    );
}

/**
 * Deletes a set of distinct documents table by table, so the statement count
 * does not grow with the set. Callers keep the set within the SQL parameter
 * limit (`organizationPurgeBatches`). Every document must exist: a missing one
 * fails the whole call with 404, as a single-document purge always has.
 */
export async function deleteDocumentRows(input: {
  readonly documentIds: readonly string[];
  readonly executor: DatabaseTransaction;
  readonly orphanedBlobIds: readonly string[];
  readonly retainAccessHistory: boolean;
}): Promise<void> {
  const { documentIds, executor } = input;
  if (documentIds.length === 0) return;

  await deleteDocumentContentRows(documentIds, executor);
  await deleteDocumentAttachmentRows(input);
  await deleteDocumentAccessHeads(documentIds, executor);
  if (!input.retainAccessHistory) {
    await deleteDocumentAccessHistory(documentIds, executor);
  }

  // Current link projection, then the document rows themselves.
  const deleted = await executor
    .delete(documents)
    .where(inArray(documents.id, [...documentIds]))
    .returning({ id: documents.id });
  if (deleted.length !== new Set(documentIds).size) {
    throw new DocumentMutationError("Document not found", 404);
  }
}
