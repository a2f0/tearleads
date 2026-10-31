import { and, eq, inArray, sql } from "drizzle-orm";
import {
  deleteDocumentPlacementRowsByContainerIds,
  deleteDocumentPlacementRowsByDocumentIds,
} from "../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { recordSupersededContainerBindingsInTransaction } from "../../../data/persistence/container-contents/supersededContainerBindings";
import {
  containerHydrationTombstones,
  containerSyncWatermarks,
  containers,
  documentContainerProjection,
  dormantContainerMetadata,
  dormantMetadataSweepRequests,
  inContainerIntentLanes,
  inLocalIntentLane,
  LOCAL_INTENT_LANES,
  localIntents,
} from "../../../data/sqlite/schema";
import { documentIntentLinkTargets } from "../../../data/sqlite/schema/documentPlacementIntentSchema";
import { remoteResetBatches } from "../../../data/sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { isRemoteResetSyncCursor } from "./remoteResetCursorScope";

// Container Contents' part of a remote reset. The sync remote reset calls these
// in one transaction: it forgets the organization's server state, strips server
// identity from the folders it keeps, and queues them to be created again.
export { clearRemoteResetSyncCursors } from "./remoteResetCursorScope";

const CONTAINER_CREATE_INTENT_TYPE = "container.create";

export interface ContainerRemoteReset {
  readonly organizationId: string;
  readonly replacement?:
    | {
        readonly organizationId: string;
        readonly rootContainerId: string;
      }
    | undefined;
}

export interface ResetContainerRow {
  readonly id: string;
  readonly parentId: string | null;
}

/** The organization's live folders, plus the ids of its dormant ones. */
export async function loadContainerResetScope(
  tx: ClientSQLiteTransactionScope,
  organizationId: string,
): Promise<{
  containerIds: string[];
  containerRows: ResetContainerRow[];
}> {
  const liveContainerRows = (
    await tx
      .select({ id: containers.id, parentId: containers.parentId })
      .from(containers)
      .where(eq(containers.organizationId, organizationId))
  ).flatMap((row) => (row.id ? [{ id: row.id, parentId: row.parentId }] : []));
  const dormantContainerRows = await tx
    .select({ id: dormantContainerMetadata.containerId })
    .from(dormantContainerMetadata)
    .where(eq(dormantContainerMetadata.organizationId, organizationId));
  const containerRows = liveContainerRows;
  return {
    containerIds: [
      ...new Set([
        ...containerRows.map((row) => row.id),
        ...dormantContainerRows.map((row) => row.id),
      ]),
    ],
    containerRows,
  };
}

/** Every document placement, which decides the documents a reset covers. */
export function listDocumentPlacementRows(tx: ClientSQLiteTransactionScope) {
  return tx.select().from(documentContainerProjection);
}

/** Counts the queued folder and document move intents a reset clears. */
export async function countContainerResetIntents(input: {
  containerIds: readonly string[];
  documentLocalIds: readonly string[];
  tx: ClientSQLiteTransactionScope;
}): Promise<{
  clearedContainerCreateIntentCount: number;
  clearedContainerMoveIntentCount: number;
  clearedDocumentMoveIntentCount: number;
}> {
  const containerIdSet = new Set(input.containerIds);
  const documentLocalIdSet = new Set(input.documentLocalIds);
  const intents = await input.tx
    .select({
      lane: localIntents.lane,
      localId: localIntents.localId,
      subjectId: localIntents.subjectId,
    })
    .from(localIntents);
  const containerIntentCount = (lane: string) =>
    intents.filter(
      (row) => row.lane === lane && containerIdSet.has(row.subjectId),
    ).length;
  return {
    clearedContainerCreateIntentCount: containerIntentCount(
      LOCAL_INTENT_LANES.containerCreate,
    ),
    clearedContainerMoveIntentCount: containerIntentCount(
      LOCAL_INTENT_LANES.containerMove,
    ),
    clearedDocumentMoveIntentCount: intents.filter(
      (row) =>
        row.lane === LOCAL_INTENT_LANES.documentPlacement &&
        row.localId !== null &&
        documentLocalIdSet.has(row.localId),
    ).length,
  };
}

/** Counts the sync cursors `clearRemoteResetSyncCursors` deletes. */
export async function countRemoteResetSyncCursors(input: {
  containerIds: readonly string[];
  tx: ClientSQLiteTransactionScope;
}): Promise<number> {
  const scopedContainerIds = new Set(input.containerIds);
  const syncLanes = await input.tx.select().from(containerSyncWatermarks);
  return syncLanes.filter((row) =>
    isRemoteResetSyncCursor({
      containerIds: scopedContainerIds,
      row,
    }),
  ).length;
}

export async function clearDormantContainerMetadataForRemoteReset(
  tx: ClientSQLiteTransactionScope,
  organizationId: string,
): Promise<void> {
  for (const table of [
    dormantContainerMetadata,
    dormantMetadataSweepRequests,
  ] as const) {
    await tx
      .delete(table)
      .where(eq(table.organizationId, organizationId))
      .run();
  }
}

/** Clears the folders' placements, queued intents, and hydration tombstones. */
export async function clearContainerRowsForRemoteReset(input: {
  containerIds: readonly string[];
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  for (const containerBatch of remoteResetBatches(input.containerIds)) {
    await deleteDocumentPlacementRowsByContainerIds(input.tx, containerBatch);
    await input.tx
      .delete(localIntents)
      .where(
        and(
          inContainerIntentLanes(),
          inArray(localIntents.subjectId, containerBatch),
        ),
      )
      .run();
    await input.tx
      .delete(containerHydrationTombstones)
      .where(inArray(containerHydrationTombstones.containerId, containerBatch))
      .run();
  }
}

/** Clears the documents' placements and their queued placement intents. */
export async function clearDocumentPlacementsForRemoteReset(input: {
  documentLocalIds: readonly string[];
  oldDocumentIds: readonly string[];
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { tx } = input;
  for (const documentIdBatch of remoteResetBatches(input.oldDocumentIds)) {
    await deleteDocumentPlacementRowsByDocumentIds(tx, documentIdBatch);
  }
  for (const localIdBatch of remoteResetBatches(input.documentLocalIds)) {
    const placementIntents = and(
      inLocalIntentLane(LOCAL_INTENT_LANES.documentPlacement),
      inArray(localIntents.localId, localIdBatch),
    );
    await tx
      .delete(documentIntentLinkTargets)
      .where(
        inArray(
          documentIntentLinkTargets.intentId,
          tx
            .select({ id: localIntents.id })
            .from(localIntents)
            .where(placementIntents),
        ),
      )
      .run();
    await tx.delete(localIntents).where(placementIntents).run();
  }
}

/**
 * Drops the folders' server timestamps and metadata document, and moves them
 * to the replacement organization when there is one.
 */
export async function resetContainerServerIdentity(input: {
  containerIds: readonly string[];
  containerRows: readonly ResetContainerRow[];
  now: string;
  reset: ContainerRemoteReset;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { now, reset, tx } = input;
  // Replacement re-homes folders under their ids; the purged organization
  // can never bind them again on this device.
  for (const containerIds of reset.replacement
    ? remoteResetBatches(input.containerIds)
    : []) {
    await recordSupersededContainerBindingsInTransaction(tx, {
      containerIds,
      organizationId: reset.organizationId,
      supersededAt: now,
    });
  }
  // One update per batch: SQLite evaluates every SET value against the old
  // row, and no earlier reset step writes `parent_id`, so COALESCE re-homes
  // exactly the root folders the snapshot read with a null parent.
  for (const rowBatch of remoteResetBatches(input.containerRows)) {
    await tx
      .update(containers)
      .set({
        metadataDocumentId: null,
        organizationId:
          reset.replacement?.organizationId ?? reset.organizationId,
        ...(reset.replacement
          ? {
              parentId: sql`coalesce(${containers.parentId}, ${reset.replacement.rootContainerId})`,
              systemSlot: null,
            }
          : {}),
        serverCreatedAt: null,
        serverUpdatedAt: null,
        localUpdatedAt: now,
      })
      .where(
        inArray(
          containers.id,
          rowBatch.map((row) => row.id),
        ),
      )
      .run();
  }
}

/** Queues a create for every kept folder that has a parent to create it in. */
export async function queueContainerCreatesForRemoteReset(input: {
  containerRows: readonly ResetContainerRow[];
  now: string;
  reset: ContainerRemoteReset;
  tx: ClientSQLiteTransactionScope;
}): Promise<number> {
  const rows = input.containerRows.flatMap((row) => {
    const parentId =
      row.parentId ?? input.reset.replacement?.rootContainerId ?? null;
    return parentId ? [{ id: row.id, parentId }] : [];
  });
  if (rows.length === 0) return 0;
  for (const rowBatch of remoteResetBatches(rows)) {
    await input.tx
      .insert(localIntents)
      .values(
        rowBatch.map((row) => ({
          id: crypto.randomUUID(),
          lane: LOCAL_INTENT_LANES.containerCreate,
          subjectId: row.id,
          targetContainerId: row.parentId,
          intentType: CONTAINER_CREATE_INTENT_TYPE,
          syncStatus: "pending" as const,
          remoteContainerId: null,
          remoteMetadataAccessStateHash: null,
          remoteMetadataDocumentId: null,
          lastError: null,
          createdAt: input.now,
          updatedAt: input.now,
        })),
      )
      .run();
  }
  return rows.length;
}
