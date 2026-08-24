import { and, eq, isNotNull } from "drizzle-orm";
import { DEFAULT_DOCUMENT_KIND } from "../../../documents/documentConstants";
import {
  type DocumentProjectorRegistry,
  type DocumentProjectorRegistryInput,
  resolveDocumentProjectorRegistry,
} from "../../../documents/documentKinds";
import { deleteDocumentHistory } from "../../../sqlite/documentHistoryPersistence";
import {
  clearDocumentSyncFailure,
  deleteDocumentPendingUpdates,
} from "../../../sqlite/documentPersistence";
import {
  documentAttachmentBlobProjection,
  documentMoveIntents,
  documentMoveIntentTables,
  documentPendingAttachments,
} from "../../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../../sqlite/sqlSchema";
import type {
  DiscardDocumentToShellResult,
  DocumentsPersistence,
  StoredDocumentRecord,
} from "../types";
import {
  getDocumentScope,
  resolveDocumentSaveTimestamp,
  saveDocumentRows,
} from "./documentRows";

function buildDiscardShellDocument(
  localId: string,
  existingDocument: StoredDocumentRecord,
): StoredDocumentRecord {
  return {
    id: localId,
    accessEpoch: existingDocument.accessEpoch,
    accessStateHash: existingDocument.accessStateHash ?? null,
    containerId: existingDocument.containerId,
    contentKeyBundle: null,
    documentId: existingDocument.documentId,
    documentKekTargets: null,
    documentManifestBundle: null,
    effectiveAccessLevel: existingDocument.effectiveAccessLevel ?? null,
    lastCommitLsn: null,
    pendingBaseVersion: null,
    pullContinuation: null,
    snapshotEndVersion: "",
    text: "",
    ...(existingDocument.documentKind === undefined
      ? {}
      : { documentKind: existingDocument.documentKind }),
    ...(existingDocument.title === undefined
      ? {}
      : { title: existingDocument.title }),
  };
}

// The single transaction behind the discard: row teardown, the document-kind
// client-projection clear, and the shell upsert commit together, so an
// interruption leaves either the fully old or the fully shelled document.
// Staged-upload rows AND detached local-attachment markers both go: a marker
// for a locally-discarded detach would otherwise keep filtering the slot out
// of every projection after the re-pull restores it (hydration skips the slot
// because its cached storage key still matches), leaving the attachment
// permanently invisible.
async function discardDocumentRowsToShell(input: {
  documentProjectors: DocumentProjectorRegistry;
  existingDocument: StoredDocumentRecord;
  localId: string;
  lockedExecSql: ExecSql;
  pendingAttachments: ReadonlyArray<{ slotId: string; storageKey: string }>;
}): Promise<void> {
  const {
    documentProjectors,
    existingDocument,
    localId,
    lockedExecSql,
    pendingAttachments,
  } = input;
  const shellDocument = buildDiscardShellDocument(localId, existingDocument);
  const clientProjectionTables = documentProjectors.getClientProjectionTables();
  if (clientProjectionTables.length > 0) {
    await ensureSqlTables(lockedExecSql, clientProjectionTables);
  }
  await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
    async (tx) => {
      await deleteDocumentPendingUpdates(
        lockedExecSql,
        getDocumentScope(localId),
      );
      await tx
        .delete(documentPendingAttachments)
        .where(eq(documentPendingAttachments.localId, localId))
        .run();
      for (const pendingAttachment of pendingAttachments) {
        await tx
          .delete(documentAttachmentBlobProjection)
          .where(
            and(
              eq(documentAttachmentBlobProjection.localId, localId),
              eq(
                documentAttachmentBlobProjection.slotId,
                pendingAttachment.slotId,
              ),
              eq(
                documentAttachmentBlobProjection.storageKey,
                pendingAttachment.storageKey,
              ),
            ),
          )
          .run();
      }
      await tx
        .delete(documentAttachmentBlobProjection)
        .where(
          and(
            eq(documentAttachmentBlobProjection.localId, localId),
            isNotNull(documentAttachmentBlobProjection.detachedAt),
          ),
        )
        .run();
      await deleteDocumentHistory(lockedExecSql, getDocumentScope(localId));
      await clearDocumentSyncFailure(lockedExecSql, getDocumentScope(localId));
      // The document-kind client projection (e.g. a contact's projected
      // fields) derives from the discarded content and is read directly by
      // consumers, so it must not outlive the rows it derived from. Clearing
      // it INSIDE the transaction keeps the discard all-or-nothing; the
      // re-pull's persist rebuilds it. Projector deletes are runMutation
      // -based plain statements, so they join this open transaction.
      await documentProjectors.deleteStoredDocumentClientProjection({
        documentKind: shellDocument.documentKind ?? DEFAULT_DOCUMENT_KIND,
        execSql: lockedExecSql,
        localId,
      });
      const updatedAt = await resolveDocumentSaveTimestamp({
        document: shellDocument,
        tx,
      });
      await saveDocumentRows({
        document: shellDocument,
        tx,
        updatedAt,
      });
    },
  );
}

/**
 * Atomically convert a stuck document's local state to the
 * freshly-discovered-share shell: drop its queued updates, staged attachment
 * rows (and their settled local-attachment halves, which share the staged
 * storage keys the caller reclaims), detached attachment markers, durable
 * history, recorded sync failure, and document-kind client projection, then
 * overwrite the record with an empty snapshot that keeps its identity,
 * placement, title, and kind. Everything commits in ONE transaction.
 *
 * Refused under the serialized mutation when the document is local-only or
 * unlinked (its rows are the only copy), when its documentId no longer
 * matches the caller's expectation (a stale caller or racing relink must not
 * discard a different identity's edits), or when any move intent references
 * it (the local containerId is then the move's optimistic placement, and
 * reseeding it as server truth would silently commit the move locally while
 * discarding the intent that was meant to perform it).
 */
export async function discardStoredDocumentToShell(input: {
  documentProjectors: DocumentProjectorRegistryInput;
  execSql: ExecSql;
  expectedDocumentId: string;
  localId: string;
  persistence: Pick<
    DocumentsPersistence,
    "listPendingAttachments" | "loadDocument"
  >;
}): Promise<DiscardDocumentToShellResult> {
  const { expectedDocumentId, localId, persistence } = input;
  return runSerializedSqlMutation(input.execSql, async (lockedExecSql) => {
    await ensureSqlTables(lockedExecSql, documentMoveIntentTables);
    const existingDocument = await persistence.loadDocument(
      lockedExecSql,
      localId,
    );
    if (
      !existingDocument?.documentId ||
      existingDocument.documentId !== expectedDocumentId ||
      !existingDocument.containerId
    ) {
      return { discarded: false };
    }
    const { db } = getClientSQLitePersistenceRuntime(lockedExecSql);
    const moveIntentRows = await db
      .select({ id: documentMoveIntents.id })
      .from(documentMoveIntents)
      .where(eq(documentMoveIntents.localId, localId))
      .limit(1);
    if (moveIntentRows.length > 0) {
      return { discarded: false };
    }
    const pendingAttachments = await persistence.listPendingAttachments(
      lockedExecSql,
      localId,
    );
    const detachedRows = await db
      .select({
        storageKey: documentAttachmentBlobProjection.storageKey,
      })
      .from(documentAttachmentBlobProjection)
      .where(
        and(
          eq(documentAttachmentBlobProjection.localId, localId),
          isNotNull(documentAttachmentBlobProjection.detachedAt),
        ),
      );

    await discardDocumentRowsToShell({
      documentProjectors: resolveDocumentProjectorRegistry(
        input.documentProjectors,
      ),
      existingDocument,
      localId,
      lockedExecSql,
      pendingAttachments,
    });
    return {
      discarded: true,
      documentKind: existingDocument.documentKind ?? DEFAULT_DOCUMENT_KIND,
      reclaimableBlobStorageKeys: [
        ...new Set([
          ...pendingAttachments.map(
            (pendingAttachment) => pendingAttachment.storageKey,
          ),
          ...detachedRows.map((detachedRow) => detachedRow.storageKey),
        ]),
      ],
    };
  });
}
