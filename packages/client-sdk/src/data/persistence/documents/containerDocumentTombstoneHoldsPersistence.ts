import { documentContainerProjectionTables } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import {
  type ContainerDocumentPlacementKey,
  deleteContainerDocumentTombstoneHoldRows,
  type HeldContainerDocumentTombstone,
  holdContainerDocumentTombstonesInTransaction,
  listContainerDocumentTombstoneHoldsInTransaction,
  listKnownContainerDocumentPlacementsInTransaction,
  listRetryableContainerDocumentTombstoneHoldsInTransaction,
} from "./internal/containerDocumentTombstoneHolds";

export type {
  ContainerDocumentPlacementKey,
  HeldContainerDocumentTombstone,
} from "./internal/containerDocumentTombstoneHolds";

/**
 * A held tombstone is re-verified no more often than this. An honest hold
 * that can never verify (the requester lost read access to the document)
 * would otherwise cost a head fetch on every discovery of its container.
 */
export const HELD_TOMBSTONE_RETRY_INTERVAL_MS = 15 * 60 * 1000;

function heldTombstoneRetryBefore(now: Date): string {
  return new Date(
    now.getTime() - HELD_TOMBSTONE_RETRY_INTERVAL_MS,
  ).toISOString();
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
): Promise<ContainerDocumentPlacementKey[]> {
  if (containerIds.length === 0) return [];
  await ensureSqlTables(execSql, documentContainerProjectionTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  return listContainerDocumentTombstoneHoldsInTransaction(db, containerIds);
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

/** Prunes stale holds as a serialized write, then lists the ones due. */
export async function listRetryableHeldContainerDocumentTombstones(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
  now = new Date(),
): Promise<HeldContainerDocumentTombstone[]> {
  if (containerIds.length === 0) return [];
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
    const { db } = getClientSQLitePersistenceRuntime(lockedExecSql);
    return db.transaction((tx) =>
      listRetryableContainerDocumentTombstoneHoldsInTransaction(tx, {
        containerIds,
        retryBefore: heldTombstoneRetryBefore(now),
      }),
    );
  });
}
