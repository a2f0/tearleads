import type { SyncWatermark } from "@tearleads/validators/response";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  containerSyncWatermarks,
  containerSyncWatermarkTables,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";

const CONTAINER_PARENT_LANE = "container_parent";
const CONTAINER_DOCUMENTS_LANE = "container_documents";
const ROOT_CONTAINER_PARENT_LANE_ID = "root";
const CONTAINER_PARENT_LANE_ID_PREFIX = "parent:";

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

export const containerParentSyncLane = (
  parentId: string | null,
): ContainerSyncWatermarkLane => ({
  kind: CONTAINER_PARENT_LANE,
  parentId,
});

export const containerDocumentsSyncLane = (
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

async function selectWatermarkRows(
  execSql: ExecSql,
  lanes: ReadonlyArray<ContainerSyncWatermarkLane>,
): Promise<SelectedContainerSyncWatermark[]> {
  const laneKeys = uniqueLaneKeys(lanes);
  if (laneKeys.length === 0) {
    return [];
  }

  await ensureSqlTables(execSql, containerSyncWatermarkTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const lanePredicates = laneKeys.map(({ laneId, laneKind }) =>
    and(
      eq(containerSyncWatermarks.laneKind, laneKind),
      eq(containerSyncWatermarks.laneId, laneId),
    ),
  );
  const whereClause =
    lanePredicates.length === 1 ? lanePredicates[0] : or(...lanePredicates);
  if (!whereClause) {
    return [];
  }

  const rows = await db
    .select({
      laneId: containerSyncWatermarks.laneId,
      laneKind: containerSyncWatermarks.laneKind,
      updatedAt: containerSyncWatermarks.updatedAt,
      watermarkId: containerSyncWatermarks.watermarkId,
      watermarkUpdatedAt: containerSyncWatermarks.watermarkUpdatedAt,
    })
    .from(containerSyncWatermarks)
    .where(whereClause);

  return rows;
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
    const parentLaneIds = uniqueContainerIds.map((containerId) =>
      containerParentLaneId(containerId),
    );

    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
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
    });
  },
};
