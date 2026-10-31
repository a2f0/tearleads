import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
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
import { forgetTransactionAccessManifestBundles } from "../../../access/write/accessManifestStore";
import { wallClockNowExpression } from "../../../utils/sqlDialect";
import { DocumentMutationError } from "./errors";

// Content-key targets reference documentContentKeyEpochs(id); the loro update
// payloads, write headers, and baseline markers are independent.
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
    .delete(documentInlineRekeyCommits)
    .where(eq(documentInlineRekeyCommits.documentId, documentId));
  await executor
    .delete(documentBaselines)
    .where(eq(documentBaselines.documentId, documentId));
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
  forgetTransactionAccessManifestBundles(executor);
  await executor
    .delete(documentManifestObservations)
    .where(eq(documentManifestObservations.documentId, documentId));
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

  await deleteDocumentContentRows(documentId, executor);
  await deleteDocumentAttachmentRows(input);
  await deleteDocumentAccessHead(documentId, executor);
  if (!input.retainAccessHistory) {
    await deleteDocumentAccessHistory(documentId, executor);
  }

  // Current link projection, then the document row itself.
  const [deleted] = await executor
    .delete(documents)
    .where(eq(documents.id, documentId))
    .returning({ id: documents.id });
  if (!deleted) {
    throw new DocumentMutationError("Document not found", 404);
  }
}
