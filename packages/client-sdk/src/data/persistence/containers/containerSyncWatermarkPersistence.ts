import type { SyncWatermark } from "@tearleads/validators/response";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import {
  containerSyncLaneChecks,
  containerSyncWatermarks,
  containerSyncWatermarkTables,
} from "../../sqlite/schema";
import {
  type ClientSQLiteDatabase,
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";

const CONTAINER_PARENT_LANE = "container_parent";
const CONTAINER_DOCUMENTS_LANE = "container_documents";
const ROOT_CONTAINER_PARENT_LANE_ID = "root";
const CONTAINER_PARENT_LANE_ID_PREFIX = "parent:";
// Each lane predicate binds two values, so keep batches comfortably under
// SQLite's variable limit when a caller reads many lanes at once.
const LANE_SELECT_BATCH_SIZE = 100;

export type ContainerSyncWatermarkLane =
  | {
      kind: typeof CONTAINER_PARENT_LANE;
      parentId: string | null;
    }
  | {
      kind: typeof CONTAINER_DOCUMENTS_LANE;
      containerId: string;
    };

interface SelectedContainerSyncWatermark {
  laneId: string;
  laneKind: string;
  updatedAt: string;
  watermarkId: string;
  watermarkUpdatedAt: string;
}

interface ContainerSyncWatermarkRecord {
  laneId: string;
  laneKind: string;
  updatedAt: string;
  watermark: SyncWatermark;
}

export interface ContainerSyncLaneCheckRecord {
  checkedAt: string;
  laneId: string;
  laneKind: string;
}

export const containerParentSyncLane = (
  parentId: string | null,
): ContainerSyncWatermarkLane => ({
  kind: CONTAINER_PARENT_LANE,
  parentId,
});

export const containerContentsSyncLane = (
  containerId: string,
): ContainerSyncWatermarkLane => ({
  kind: CONTAINER_DOCUMENTS_LANE,
  containerId,
});

export function containerSyncWatermarkLaneKey(
  lane: ContainerSyncWatermarkLane,
): {
  laneId: string;
  laneKind: string;
} {
  switch (lane.kind) {
    case CONTAINER_PARENT_LANE:
      return {
        laneKind: lane.kind,
        laneId: containerParentLaneId(lane.parentId),
      };
    case CONTAINER_DOCUMENTS_LANE:
      return {
        laneKind: lane.kind,
        laneId: lane.containerId,
      };
  }
}

function containerParentLaneId(parentId: string | null): string {
  return parentId === null
    ? ROOT_CONTAINER_PARENT_LANE_ID
    : `${CONTAINER_PARENT_LANE_ID_PREFIX}${parentId}`;
}

/**
 * The watermark half of the container-delete cascade, statement-only so the
 * caller can run it inside one atomic transaction alongside the rest of the
 * cascade.
 */
export async function deleteContainerWatermarksInTransaction(
  tx: ClientSQLiteDatabase | ClientSQLiteTransactionScope,
  containerIds: ReadonlyArray<string>,
): Promise<void> {
  const uniqueContainerIds = Array.from(new Set(containerIds));
  if (uniqueContainerIds.length === 0) {
    return;
  }
  const parentLaneIds = uniqueContainerIds.map((containerId) =>
    containerParentLaneId(containerId),
  );
  await tx
    .delete(containerSyncWatermarks)
    .where(
      or(
        and(
          eq(containerSyncWatermarks.laneKind, CONTAINER_PARENT_LANE),
          inArray(containerSyncWatermarks.laneId, parentLaneIds),
        ),
        and(
          eq(containerSyncWatermarks.laneKind, CONTAINER_DOCUMENTS_LANE),
          inArray(containerSyncWatermarks.laneId, uniqueContainerIds),
        ),
      ),
    )
    .run();
  await tx
    .delete(containerSyncLaneChecks)
    .where(
      or(
        and(
          eq(containerSyncLaneChecks.laneKind, CONTAINER_PARENT_LANE),
          inArray(containerSyncLaneChecks.laneId, parentLaneIds),
        ),
        and(
          eq(containerSyncLaneChecks.laneKind, CONTAINER_DOCUMENTS_LANE),
          inArray(containerSyncLaneChecks.laneId, uniqueContainerIds),
        ),
      ),
    )
    .run();
}

function mapSelectedWatermarkRecord(
  row: SelectedContainerSyncWatermark | undefined,
): ContainerSyncWatermarkRecord | null {
  return row
    ? {
        laneId: row.laneId,
        laneKind: row.laneKind,
        updatedAt: row.updatedAt,
        watermark: {
          id: row.watermarkId,
          updatedAt: row.watermarkUpdatedAt,
        },
      }
    : null;
}

function laneKeyString(input: { laneId: string; laneKind: string }): string {
  return `${input.laneKind}\0${input.laneId}`;
}

function uniqueLaneKeys(
  lanes: ReadonlyArray<ContainerSyncWatermarkLane>,
): Array<{ laneId: string; laneKind: string }> {
  const seen = new Set<string>();
  const laneKeys: Array<{ laneId: string; laneKind: string }> = [];

  for (const lane of lanes) {
    const laneKey = containerSyncWatermarkLaneKey(lane);
    const key = laneKeyString(laneKey);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    laneKeys.push(laneKey);
  }

  return laneKeys;
}

// The ONE batched lane-select shape for this file: both row readers must
// chunk, because a caller may pass unboundedly many lanes and each lane
// predicate binds two variables.
async function selectLaneRowsInBatches<TRow>(
  lanes: ReadonlyArray<ContainerSyncWatermarkLane>,
  buildLanePredicate: (laneKey: {
    laneId: string;
    laneKind: string;
  }) => SQL | undefined,
  selectBatch: (whereClause: SQL) => Promise<TRow[]>,
): Promise<TRow[]> {
  const laneKeys = uniqueLaneKeys(lanes);
  const rows: TRow[] = [];

  for (
    let index = 0;
    index < laneKeys.length;
    index += LANE_SELECT_BATCH_SIZE
  ) {
    const lanePredicates = laneKeys
      .slice(index, index + LANE_SELECT_BATCH_SIZE)
      .map(buildLanePredicate)
      .filter((predicate): predicate is SQL => predicate !== undefined);
    const whereClause =
      lanePredicates.length === 1 ? lanePredicates[0] : or(...lanePredicates);
    if (!whereClause) {
      continue;
    }

    rows.push(...(await selectBatch(whereClause)));
  }

  return rows;
}

async function selectWatermarkRows(
  execSql: ExecSql,
  lanes: ReadonlyArray<ContainerSyncWatermarkLane>,
): Promise<SelectedContainerSyncWatermark[]> {
  await ensureSqlTables(execSql, containerSyncWatermarkTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);

  return selectLaneRowsInBatches(
    lanes,
    ({ laneId, laneKind }) =>
      and(
        eq(containerSyncWatermarks.laneKind, laneKind),
        eq(containerSyncWatermarks.laneId, laneId),
      ),
    (whereClause) =>
      db
        .select({
          laneId: containerSyncWatermarks.laneId,
          laneKind: containerSyncWatermarks.laneKind,
          updatedAt: containerSyncWatermarks.updatedAt,
          watermarkId: containerSyncWatermarks.watermarkId,
          watermarkUpdatedAt: containerSyncWatermarks.watermarkUpdatedAt,
        })
        .from(containerSyncWatermarks)
        .where(whereClause),
  );
}

async function selectCheckRows(
  execSql: ExecSql,
  lanes: ReadonlyArray<ContainerSyncWatermarkLane>,
): Promise<ContainerSyncLaneCheckRecord[]> {
  await ensureSqlTables(execSql, containerSyncWatermarkTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);

  return selectLaneRowsInBatches(
    lanes,
    ({ laneId, laneKind }) =>
      and(
        eq(containerSyncLaneChecks.laneKind, laneKind),
        eq(containerSyncLaneChecks.laneId, laneId),
      ),
    (whereClause) =>
      db
        .select({
          checkedAt: containerSyncLaneChecks.checkedAt,
          laneId: containerSyncLaneChecks.laneId,
          laneKind: containerSyncLaneChecks.laneKind,
        })
        .from(containerSyncLaneChecks)
        .where(whereClause),
  );
}

export const sqlContainerSyncWatermarkPersistence = {
  async ensureSchema(execSql: ExecSql): Promise<void> {
    await ensureSqlTables(execSql, containerSyncWatermarkTables);
  },

  async loadWatermark(
    execSql: ExecSql,
    lane: ContainerSyncWatermarkLane,
  ): Promise<SyncWatermark | null> {
    const [record] =
      await sqlContainerSyncWatermarkPersistence.loadWatermarkRecords(execSql, [
        lane,
      ]);
    return record?.watermark ?? null;
  },

  async loadWatermarkRecord(
    execSql: ExecSql,
    lane: ContainerSyncWatermarkLane,
  ): Promise<ContainerSyncWatermarkRecord | null> {
    return (
      (
        await sqlContainerSyncWatermarkPersistence.loadWatermarkRecords(
          execSql,
          [lane],
        )
      )[0] ?? null
    );
  },

  async loadWatermarkRecords(
    execSql: ExecSql,
    lanes: ReadonlyArray<ContainerSyncWatermarkLane>,
  ): Promise<Array<ContainerSyncWatermarkRecord | null>> {
    const rows = await selectWatermarkRows(execSql, lanes);
    const recordsByKey = new Map<string, ContainerSyncWatermarkRecord>();

    for (const row of rows) {
      const record = mapSelectedWatermarkRecord(row);
      if (record) {
        recordsByKey.set(laneKeyString(record), record);
      }
    }

    return lanes.map((lane) => {
      const laneKey = containerSyncWatermarkLaneKey(lane);
      return recordsByKey.get(laneKeyString(laneKey)) ?? null;
    });
  },

  async loadCheckRecord(
    execSql: ExecSql,
    lane: ContainerSyncWatermarkLane,
  ): Promise<ContainerSyncLaneCheckRecord | null> {
    return (
      (
        await sqlContainerSyncWatermarkPersistence.loadCheckRecords(execSql, [
          lane,
        ])
      )[0] ?? null
    );
  },

  async loadCheckRecords(
    execSql: ExecSql,
    lanes: ReadonlyArray<ContainerSyncWatermarkLane>,
  ): Promise<Array<ContainerSyncLaneCheckRecord | null>> {
    const rows = await selectCheckRows(execSql, lanes);
    const recordsByKey = new Map<string, ContainerSyncLaneCheckRecord>();

    for (const row of rows) {
      recordsByKey.set(laneKeyString(row), row);
    }

    return lanes.map((lane) => {
      const laneKey = containerSyncWatermarkLaneKey(lane);
      return recordsByKey.get(laneKeyString(laneKey)) ?? null;
    });
  },

  async markChecked(
    execSql: ExecSql,
    lane: ContainerSyncWatermarkLane,
  ): Promise<void> {
    await sqlContainerSyncWatermarkPersistence.ensureSchema(execSql);
    const { laneId, laneKind } = containerSyncWatermarkLaneKey(lane);
    const row = {
      checkedAt: new Date().toISOString(),
      laneId,
      laneKind,
    };

    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .insert(containerSyncLaneChecks)
        .values(row)
        .onConflictDoUpdate({
          target: [
            containerSyncLaneChecks.laneKind,
            containerSyncLaneChecks.laneId,
          ],
          set: row,
        })
        .run();
    });
  },

  async saveWatermark(
    execSql: ExecSql,
    lane: ContainerSyncWatermarkLane,
    watermark: SyncWatermark,
  ): Promise<void> {
    await sqlContainerSyncWatermarkPersistence.ensureSchema(execSql);
    const { laneId, laneKind } = containerSyncWatermarkLaneKey(lane);
    const updatedAt = new Date().toISOString();
    const row = {
      laneId,
      laneKind,
      watermarkId: watermark.id,
      watermarkUpdatedAt: watermark.updatedAt,
      updatedAt,
    };

    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .insert(containerSyncWatermarks)
        .values(row)
        .onConflictDoUpdate({
          target: [
            containerSyncWatermarks.laneKind,
            containerSyncWatermarks.laneId,
          ],
          set: row,
        })
        .run();
    });
  },

  async deleteWatermarksForContainers(
    execSql: ExecSql,
    containerIds: ReadonlyArray<string>,
  ): Promise<void> {
    const uniqueContainerIds = Array.from(new Set(containerIds));
    if (uniqueContainerIds.length === 0) {
      return;
    }

    await sqlContainerSyncWatermarkPersistence.ensureSchema(execSql);
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await deleteContainerWatermarksInTransaction(db, uniqueContainerIds);
    });
  },
};
