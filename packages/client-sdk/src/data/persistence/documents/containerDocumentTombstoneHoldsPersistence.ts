import { documentContainerProjectionTables } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import {
  type ContainerDocumentPlacementKey,
  type ContainerDocumentTombstoneHoldRow,
  deleteContainerDocumentTombstoneHoldRows,
  type HeldContainerDocumentTombstone,
  holdContainerDocumentTombstonesInTransaction,
  listContainerDocumentTombstoneHoldsForDocumentsInTransaction,
  listContainerDocumentTombstoneHoldsInTransaction,
  listKnownContainerDocumentPlacementsInTransaction,
  partitionContainerDocumentTombstoneHolds,
} from "./internal/containerDocumentTombstoneHolds";

export {
  type ContainerDocumentPlacementKey,
  containerDocumentPlacementKey,
  type HeldContainerDocumentTombstone,
} from "./internal/containerDocumentTombstoneHolds";

/**
 * Retry backoff for a held tombstone: fifteen minutes after the first failed
 * verification, doubling on every further failure up to about a day. An
 * honest hold that can never verify (the requester lost read access to the
 * document, or it was purged elsewhere) would otherwise cost a head fetch on
 * every discovery of its container for as long as the container exists.
 */
export const HELD_TOMBSTONE_RETRY_INTERVAL_MS = 15 * 60 * 1000;
const HELD_TOMBSTONE_MAX_BACKOFF_DOUBLINGS = 7;

export function heldTombstoneRetryDelayMs(attempts: number): number {
  const doublings = Math.min(
    Math.max(attempts, 1) - 1,
    HELD_TOMBSTONE_MAX_BACKOFF_DOUBLINGS,
  );
  return HELD_TOMBSTONE_RETRY_INTERVAL_MS * 2 ** doublings;
}

function isHoldDue(
  hold: ContainerDocumentTombstoneHoldRow,
  now: Date,
): boolean {
  return (
    Date.parse(hold.updatedAt) + heldTombstoneRetryDelayMs(hold.attempts) <=
    now.getTime()
  );
}

export async function holdContainerDocumentTombstones(
  execSql: ExecSql,
  tombstones: ReadonlyArray<HeldContainerDocumentTombstone>,
  now = new Date().toISOString(),
): Promise<void> {
  if (tombstones.length === 0) return;
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
    const { db } = getClientSQLitePersistenceRuntime(lockedExecSql);
    await db.transaction((tx) =>
      holdContainerDocumentTombstonesInTransaction(tx, tombstones, now),
    );
  });
}

export async function releaseContainerDocumentTombstoneHolds(
  execSql: ExecSql,
  placements: ReadonlyArray<ContainerDocumentPlacementKey>,
): Promise<void> {
  if (placements.length === 0) return;
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
    const { db } = getClientSQLitePersistenceRuntime(lockedExecSql);
    await db.transaction((tx) =>
      deleteContainerDocumentTombstoneHoldRows(tx, placements),
    );
  });
}

export async function listContainerDocumentTombstoneHolds(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<ContainerDocumentTombstoneHoldRow[]> {
  if (containerIds.length === 0) return [];
  await ensureSqlTables(execSql, documentContainerProjectionTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  return listContainerDocumentTombstoneHoldsInTransaction(db, containerIds);
}

export async function listContainerDocumentTombstoneHoldsForDocuments(
  execSql: ExecSql,
  documentIds: ReadonlyArray<string>,
): Promise<ContainerDocumentPlacementKey[]> {
  if (documentIds.length === 0) return [];
  await ensureSqlTables(execSql, documentContainerProjectionTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  return listContainerDocumentTombstoneHoldsForDocumentsInTransaction(
    db,
    documentIds,
  );
}

export async function listKnownContainerDocumentPlacements(
  execSql: ExecSql,
  placements: ReadonlyArray<ContainerDocumentPlacementKey>,
): Promise<ContainerDocumentPlacementKey[]> {
  if (placements.length === 0) return [];
  await ensureSqlTables(execSql, documentContainerProjectionTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  return listKnownContainerDocumentPlacementsInTransaction(db, placements);
}

/**
 * The held tombstones on the given containers that are due for another
 * verification attempt. Holds whose placement is gone are pruned first; that
 * is the only write, and it is taken under the mutation lock only when there
 * is something to prune.
 */
export async function listRetryableHeldContainerDocumentTombstones(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
  now = new Date(),
): Promise<HeldContainerDocumentTombstone[]> {
  if (containerIds.length === 0) return [];
  await ensureSqlTables(execSql, documentContainerProjectionTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const { live, orphaned } = await partitionContainerDocumentTombstoneHolds(
    db,
    await listContainerDocumentTombstoneHoldsInTransaction(db, containerIds),
  );
  if (orphaned.length > 0) {
    await runSerializedSqlMutation(execSql, (lockedExecSql) =>
      getClientSQLitePersistenceRuntime(lockedExecSql).db.transaction((tx) =>
        deleteContainerDocumentTombstoneHoldRows(tx, orphaned),
      ),
    );
  }
  return live
    .filter((hold) => isHoldDue(hold, now))
    .map((hold) => ({
      containerId: hold.containerId,
      documentId: hold.documentId,
      updatedAt: hold.tombstonedAt,
    }));
}
