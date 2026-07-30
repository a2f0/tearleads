import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  lt,
  notExists,
  or,
  type SQL,
} from "drizzle-orm";
import { documentOrphanBlobReclaims } from "../../../sqlite/documentOrphanBlobReclaims";
import {
  documentAttachmentBlobProjection,
  documentHistoryCheckpoints,
  documentHistoryUpdates,
  documentPendingAttachments,
  documentPendingUpdates,
  documentSyncFailures,
  documents,
} from "../../../sqlite/schema";
import {
  type ClientSQLiteTransaction,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../../sqlite/sqlSchema";
import { DOCUMENTS_APP_KIND } from "./constants";

// Crash residue gets a full day to outlive slow devices and wall-clock skew;
// canonical-row absence is necessary but never sufficient for fresh writes.
const DOCUMENT_ORPHAN_SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const DOCUMENT_ORPHAN_SWEEP_BATCH_SIZE = 32;

type DocumentSideLocalIdColumn =
  | typeof documentAttachmentBlobProjection.localId
  | typeof documentHistoryCheckpoints.localId
  | typeof documentHistoryUpdates.localId
  | typeof documentPendingAttachments.localId
  | typeof documentPendingUpdates.localId
  | typeof documentSyncFailures.localId;

function requirePredicate(predicate: SQL | undefined): SQL {
  if (!predicate) {
    throw new Error("Document orphan cleanup requires a SQL predicate");
  }
  return predicate;
}

function hasNoDocument(
  tx: ClientSQLiteTransaction,
  localId: DocumentSideLocalIdColumn,
  appKind: string | null = DOCUMENTS_APP_KIND,
): SQL {
  return notExists(
    tx
      .select({ localId: documents.localId })
      .from(documents)
      .where(
        appKind === null
          ? eq(documents.localId, localId)
          : and(eq(documents.appKind, appKind), eq(documents.localId, localId)),
      ),
  );
}

export async function queueDocumentAttachmentBlobReclaims(input: {
  localWhere: SQL;
  pendingWhere: SQL;
  tx: ClientSQLiteTransaction;
}): Promise<void> {
  const { localWhere, pendingWhere, tx } = input;
  const [pendingAttachmentRows, localAttachmentRows] = await Promise.all([
    tx
      .select({ storageKey: documentPendingAttachments.storageKey })
      .from(documentPendingAttachments)
      .where(pendingWhere),
    tx
      .select({ storageKey: documentAttachmentBlobProjection.storageKey })
      .from(documentAttachmentBlobProjection)
      .where(localWhere),
  ]);
  const storageKeys = [
    ...new Set(
      [...pendingAttachmentRows, ...localAttachmentRows].map(
        (row) => row.storageKey,
      ),
    ),
  ];
  await queueDocumentAttachmentStorageKeys(tx, storageKeys);
}

async function queueDocumentAttachmentStorageKeys(
  tx: ClientSQLiteTransaction,
  storageKeys: ReadonlyArray<string>,
): Promise<void> {
  if (storageKeys.length > 0) {
    await tx
      .insert(documentOrphanBlobReclaims)
      .values(storageKeys.map((storageKey) => ({ storageKey })))
      .onConflictDoNothing()
      .run();
  }
}

interface AttachmentSweepCandidate {
  localId: string;
  slotId: string;
  storageKey: string;
}

function pendingAttachmentCandidatesWhere(
  candidates: ReadonlyArray<AttachmentSweepCandidate>,
): SQL {
  return requirePredicate(
    or(
      ...candidates.map((candidate) =>
        and(
          eq(documentPendingAttachments.localId, candidate.localId),
          eq(documentPendingAttachments.slotId, candidate.slotId),
        ),
      ),
    ),
  );
}

function localAttachmentCandidatesWhere(
  candidates: ReadonlyArray<AttachmentSweepCandidate>,
): SQL {
  return requirePredicate(
    or(
      ...candidates.map((candidate) =>
        and(
          eq(documentAttachmentBlobProjection.localId, candidate.localId),
          eq(documentAttachmentBlobProjection.slotId, candidate.slotId),
        ),
      ),
    ),
  );
}

interface HistorySweepCandidates {
  checkpoints: ReadonlyArray<{ localId: string }>;
  updates: ReadonlyArray<{ id: string | null }>;
}

interface WriteSweepCandidates {
  pendingUpdates: ReadonlyArray<{ id: string | null }>;
  syncFailures: ReadonlyArray<{ localId: string }>;
}

interface AttachmentSweepCandidates {
  local: ReadonlyArray<AttachmentSweepCandidate>;
  pending: ReadonlyArray<AttachmentSweepCandidate>;
}

async function selectHistorySweepCandidates(
  tx: ClientSQLiteTransaction,
  olderThan: string,
): Promise<HistorySweepCandidates> {
  const checkpoints = await tx
    .select({ localId: documentHistoryCheckpoints.localId })
    .from(documentHistoryCheckpoints)
    .where(
      and(
        eq(documentHistoryCheckpoints.appKind, DOCUMENTS_APP_KIND),
        lt(documentHistoryCheckpoints.updatedAt, olderThan),
        hasNoDocument(tx, documentHistoryCheckpoints.localId),
      ),
    )
    .limit(DOCUMENT_ORPHAN_SWEEP_BATCH_SIZE);
  const updates = await tx
    .select({ id: documentHistoryUpdates.id })
    .from(documentHistoryUpdates)
    .where(
      and(
        eq(documentHistoryUpdates.appKind, DOCUMENTS_APP_KIND),
        isNotNull(documentHistoryUpdates.id),
        lt(documentHistoryUpdates.createdAt, olderThan),
        hasNoDocument(tx, documentHistoryUpdates.localId),
      ),
    )
    .limit(DOCUMENT_ORPHAN_SWEEP_BATCH_SIZE);
  return { checkpoints, updates };
}

async function selectWriteSweepCandidates(
  tx: ClientSQLiteTransaction,
  olderThan: string,
): Promise<WriteSweepCandidates> {
  const pendingUpdates = await tx
    .select({ id: documentPendingUpdates.id })
    .from(documentPendingUpdates)
    .where(
      and(
        eq(documentPendingUpdates.appKind, DOCUMENTS_APP_KIND),
        isNotNull(documentPendingUpdates.id),
        lt(documentPendingUpdates.createdAt, olderThan),
        hasNoDocument(tx, documentPendingUpdates.localId),
      ),
    )
    .limit(DOCUMENT_ORPHAN_SWEEP_BATCH_SIZE);
  const syncFailures = await tx
    .select({ localId: documentSyncFailures.localId })
    .from(documentSyncFailures)
    .where(
      and(
        eq(documentSyncFailures.appKind, DOCUMENTS_APP_KIND),
        lt(documentSyncFailures.attemptedAt, olderThan),
        hasNoDocument(tx, documentSyncFailures.localId),
      ),
    )
    .limit(DOCUMENT_ORPHAN_SWEEP_BATCH_SIZE);
  return { pendingUpdates, syncFailures };
}

async function selectAttachmentSweepCandidates(
  tx: ClientSQLiteTransaction,
  olderThan: string,
): Promise<AttachmentSweepCandidates> {
  const pending = await tx
    .select({
      localId: documentPendingAttachments.localId,
      slotId: documentPendingAttachments.slotId,
      storageKey: documentPendingAttachments.storageKey,
    })
    .from(documentPendingAttachments)
    .where(
      and(
        lt(documentPendingAttachments.createdAt, olderThan),
        hasNoDocument(tx, documentPendingAttachments.localId, null),
      ),
    )
    .limit(DOCUMENT_ORPHAN_SWEEP_BATCH_SIZE);
  const local = await tx
    .select({
      localId: documentAttachmentBlobProjection.localId,
      slotId: documentAttachmentBlobProjection.slotId,
      storageKey: documentAttachmentBlobProjection.storageKey,
    })
    .from(documentAttachmentBlobProjection)
    .where(
      and(
        lt(documentAttachmentBlobProjection.updatedAt, olderThan),
        hasNoDocument(tx, documentAttachmentBlobProjection.localId, null),
      ),
    )
    .limit(DOCUMENT_ORPHAN_SWEEP_BATCH_SIZE);
  return { local, pending };
}

async function deleteHistorySweepCandidates(
  tx: ClientSQLiteTransaction,
  candidates: HistorySweepCandidates,
): Promise<void> {
  if (candidates.checkpoints.length > 0) {
    await tx
      .delete(documentHistoryCheckpoints)
      .where(
        and(
          eq(documentHistoryCheckpoints.appKind, DOCUMENTS_APP_KIND),
          inArray(
            documentHistoryCheckpoints.localId,
            candidates.checkpoints.map((row) => row.localId),
          ),
        ),
      )
      .run();
  }
  if (candidates.updates.length > 0) {
    await tx
      .delete(documentHistoryUpdates)
      .where(
        inArray(
          documentHistoryUpdates.id,
          candidates.updates.flatMap((row) =>
            row.id === null ? [] : [row.id],
          ),
        ),
      )
      .run();
  }
}

async function deleteWriteSweepCandidates(
  tx: ClientSQLiteTransaction,
  candidates: WriteSweepCandidates,
): Promise<void> {
  if (candidates.pendingUpdates.length > 0) {
    await tx
      .delete(documentPendingUpdates)
      .where(
        inArray(
          documentPendingUpdates.id,
          candidates.pendingUpdates.flatMap((row) =>
            row.id === null ? [] : [row.id],
          ),
        ),
      )
      .run();
  }
  if (candidates.syncFailures.length > 0) {
    await tx
      .delete(documentSyncFailures)
      .where(
        and(
          eq(documentSyncFailures.appKind, DOCUMENTS_APP_KIND),
          inArray(
            documentSyncFailures.localId,
            candidates.syncFailures.map((row) => row.localId),
          ),
        ),
      )
      .run();
  }
}

async function deleteAttachmentSweepCandidates(
  tx: ClientSQLiteTransaction,
  candidates: AttachmentSweepCandidates,
): Promise<void> {
  await queueDocumentAttachmentStorageKeys(tx, [
    ...new Set(
      [...candidates.pending, ...candidates.local].map((row) => row.storageKey),
    ),
  ]);
  if (candidates.pending.length > 0) {
    await tx
      .delete(documentPendingAttachments)
      .where(pendingAttachmentCandidatesWhere(candidates.pending))
      .run();
  }
  if (candidates.local.length > 0) {
    await tx
      .delete(documentAttachmentBlobProjection)
      .where(localAttachmentCandidatesWhere(candidates.local))
      .run();
  }
}

function hasFullSweepBatch(
  history: HistorySweepCandidates,
  writes: WriteSweepCandidates,
  attachments: AttachmentSweepCandidates,
): boolean {
  return [
    history.checkpoints,
    history.updates,
    writes.pendingUpdates,
    writes.syncFailures,
    attachments.pending,
    attachments.local,
  ].some((rows) => rows.length === DOCUMENT_ORPHAN_SWEEP_BATCH_SIZE);
}

/** Remove one bounded batch of aged side writes without a canonical row. */
export async function deleteOrphanedDocumentSideRows(
  execSql: ExecSql,
  options: { now?: Date | undefined } = {},
): Promise<boolean> {
  const olderThan = new Date(
    (options.now?.getTime() ?? Date.now()) - DOCUMENT_ORPHAN_SWEEP_MIN_AGE_MS,
  ).toISOString();
  return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
    getClientSQLitePersistenceRuntime(lockedExecSql).transaction(async (tx) => {
      const history = await selectHistorySweepCandidates(tx, olderThan);
      const writes = await selectWriteSweepCandidates(tx, olderThan);
      const attachments = await selectAttachmentSweepCandidates(tx, olderThan);
      await deleteHistorySweepCandidates(tx, history);
      await deleteWriteSweepCandidates(tx, writes);
      await deleteAttachmentSweepCandidates(tx, attachments);
      return hasFullSweepBatch(history, writes, attachments);
    }),
  );
}

export async function listDocumentOrphanBlobReclaims(
  execSql: ExecSql,
  limit: number,
): Promise<ReadonlyArray<string>> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({ storageKey: documentOrphanBlobReclaims.storageKey })
    .from(documentOrphanBlobReclaims)
    .orderBy(asc(documentOrphanBlobReclaims.storageKey))
    .limit(limit);
  return rows.map((row) => row.storageKey);
}

export async function isDocumentBlobStorageKeyReferenced(
  execSql: ExecSql,
  storageKey: string,
): Promise<boolean> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [pendingRows, localRows] = await Promise.all([
    db
      .select({ storageKey: documentPendingAttachments.storageKey })
      .from(documentPendingAttachments)
      .where(eq(documentPendingAttachments.storageKey, storageKey))
      .limit(1),
    db
      .select({ storageKey: documentAttachmentBlobProjection.storageKey })
      .from(documentAttachmentBlobProjection)
      .where(eq(documentAttachmentBlobProjection.storageKey, storageKey))
      .limit(1),
  ]);
  return pendingRows.length > 0 || localRows.length > 0;
}

export async function acknowledgeDocumentOrphanBlobReclaim(
  execSql: ExecSql,
  storageKey: string,
): Promise<void> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  await db
    .delete(documentOrphanBlobReclaims)
    .where(eq(documentOrphanBlobReclaims.storageKey, storageKey))
    .run();
}
