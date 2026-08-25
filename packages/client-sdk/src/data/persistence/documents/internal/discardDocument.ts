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
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
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

interface DiscardCandidate {
  detachedStorageKeys: string[];
  existingDocument: StoredDocumentRecord;
  pendingAttachments: ReadonlyArray<{ slotId: string; storageKey: string }>;
}

async function loadDiscardCandidate(input: {
  expectedDocumentId: string;
  localId: string;
  lockedExecSql: ExecSql;
  persistence: Pick<
    DocumentsPersistence,
    "listPendingAttachments" | "loadDocument"
  >;
  tx: ClientSQLiteTransactionScope;
}): Promise<DiscardCandidate | null> {
  const { expectedDocumentId, localId, lockedExecSql, persistence, tx } = input;
  const existingDocument = await persistence.loadDocument(
    lockedExecSql,
    localId,
  );
  if (
    !existingDocument?.documentId ||
    existingDocument.documentId !== expectedDocumentId ||
    !existingDocument.containerId
  ) {
    return null;
  }
  const moveIntentRows = await tx
    .select({ id: documentMoveIntents.id })
    .from(documentMoveIntents)
    .where(eq(documentMoveIntents.localId, localId))
    .limit(1);
  if (moveIntentRows.length > 0) return null;

  const pendingAttachments = await persistence.listPendingAttachments(
    lockedExecSql,
    localId,
  );
  const detachedRows = await tx
    .select({ storageKey: documentAttachmentBlobProjection.storageKey })
    .from(documentAttachmentBlobProjection)
    .where(
      and(
        eq(documentAttachmentBlobProjection.localId, localId),
        isNotNull(documentAttachmentBlobProjection.detachedAt),
      ),
    );
  return {
    detachedStorageKeys: detachedRows.map((row) => row.storageKey),
    existingDocument,
    pendingAttachments,
  };
}

// Staged-upload rows AND detached local-attachment markers both go: a marker
// for a locally-discarded detach would otherwise keep filtering the slot out
// after a re-pull restores it, leaving the attachment permanently invisible.
async function clearDiscardedDocumentRows(input: {
  candidate: DiscardCandidate;
  localId: string;
  lockedExecSql: ExecSql;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { candidate, localId, lockedExecSql, tx } = input;
  await deleteDocumentPendingUpdates(lockedExecSql, getDocumentScope(localId));
  await tx
    .delete(documentPendingAttachments)
    .where(eq(documentPendingAttachments.localId, localId))
    .run();
  for (const pendingAttachment of candidate.pendingAttachments) {
    await tx
      .delete(documentAttachmentBlobProjection)
      .where(
        and(
          eq(documentAttachmentBlobProjection.localId, localId),
          eq(documentAttachmentBlobProjection.slotId, pendingAttachment.slotId),
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
}

async function saveDiscardShell(input: {
  candidate: DiscardCandidate;
  documentProjectors: DocumentProjectorRegistry;
  localId: string;
  lockedExecSql: ExecSql;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { candidate, documentProjectors, localId, lockedExecSql, tx } = input;
  const shellDocument = buildDiscardShellDocument(
    localId,
    candidate.existingDocument,
  );
  // The document-kind projection derives from discarded content, so clear it
  // inside the transaction and let the next pull rebuild it.
  await documentProjectors.deleteStoredDocumentClientProjection({
    documentKind: shellDocument.documentKind ?? DEFAULT_DOCUMENT_KIND,
    execSql: lockedExecSql,
    localId,
  });
  const updatedAt = await resolveDocumentSaveTimestamp({
    document: shellDocument,
    tx,
  });
  await saveDocumentRows({ document: shellDocument, tx, updatedAt });
}

// Eligibility, teardown, client-projection clearing, and shell replacement
// share one immediate transaction, so a second connection cannot relink the
// local id between identity validation and destructive writes.
async function discardDocumentRowsToShell(input: {
  documentProjectors: DocumentProjectorRegistry;
  expectedDocumentId: string;
  localId: string;
  lockedExecSql: ExecSql;
  persistence: Pick<
    DocumentsPersistence,
    "listPendingAttachments" | "loadDocument"
  >;
}): Promise<DiscardDocumentToShellResult> {
  const clientProjectionTables =
    input.documentProjectors.getClientProjectionTables();
  if (clientProjectionTables.length > 0) {
    await ensureSqlTables(input.lockedExecSql, clientProjectionTables);
  }
  return getClientSQLitePersistenceRuntime(input.lockedExecSql).transaction(
    async (tx) => {
      const candidate = await loadDiscardCandidate({ ...input, tx });
      if (!candidate) return { discarded: false };
      await clearDiscardedDocumentRows({
        candidate,
        localId: input.localId,
        lockedExecSql: input.lockedExecSql,
        tx,
      });
      await saveDiscardShell({ ...input, candidate, tx });
      return {
        discarded: true,
        documentKind:
          candidate.existingDocument.documentKind ?? DEFAULT_DOCUMENT_KIND,
        reclaimableBlobStorageKeys: [
          ...new Set([
            ...candidate.pendingAttachments.map((row) => row.storageKey),
            ...candidate.detachedStorageKeys,
          ]),
        ],
      };
    },
    { behavior: "immediate" },
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
    return discardDocumentRowsToShell({
      documentProjectors: resolveDocumentProjectorRegistry(
        input.documentProjectors,
      ),
      expectedDocumentId,
      localId,
      lockedExecSql,
      persistence,
    });
  });
}
