import type { SyncWatermark } from "@tearleads/validators/response";
import { and, eq, inArray, or } from "drizzle-orm";
import { getAppDatabaseRuntime } from "../../sqlite/appDatabaseRuntime";
import {
  containerSyncWatermarks,
  containerSyncWatermarkTables,
} from "../../sqlite/schema";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";

const CONTAINER_PARENT_LANE = "container_parent";
const CONTAINER_DOCUMENTS_LANE = "container_documents";
const ROOT_CONTAINER_PARENT_LANE_ID = "root";
const CONTAINER_PARENT_LANE_ID_PREFIX = "parent:";

type ContainerSyncWatermarkLane =
  | {
      kind: typeof CONTAINER_PARENT_LANE;
      parentId: string | null;
    }
  | {
      kind: typeof CONTAINER_DOCUMENTS_LANE;
      containerId: string;
    };

interface SelectedContainerSyncWatermark {
  watermarkId: string;
  watermarkUpdatedAt: string;
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

function laneKey(lane: ContainerSyncWatermarkLane): {
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

function mapSelectedWatermark(
  row: SelectedContainerSyncWatermark | undefined,
): SyncWatermark | null {
  return row
    ? {
        id: row.watermarkId,
        updatedAt: row.watermarkUpdatedAt,
      }
    : null;
}

export const sqlContainerSyncWatermarkPersistence = {
  async ensureSchema(execSql: ExecSql): Promise<void> {
    await ensureSqlTables(execSql, containerSyncWatermarkTables);
  },

  async loadWatermark(
    execSql: ExecSql,
    lane: ContainerSyncWatermarkLane,
  ): Promise<SyncWatermark | null> {
    await sqlContainerSyncWatermarkPersistence.ensureSchema(execSql);
    const { laneId, laneKind } = laneKey(lane);
    const { db } = getAppDatabaseRuntime(execSql);
    const rows = await db
      .select({
        watermarkId: containerSyncWatermarks.watermarkId,
        watermarkUpdatedAt: containerSyncWatermarks.watermarkUpdatedAt,
      })
      .from(containerSyncWatermarks)
      .where(
        and(
          eq(containerSyncWatermarks.laneKind, laneKind),
          eq(containerSyncWatermarks.laneId, laneId),
        ),
      )
      .limit(1);

    return mapSelectedWatermark(rows[0]);
  },

  async saveWatermark(
    execSql: ExecSql,
    lane: ContainerSyncWatermarkLane,
    watermark: SyncWatermark,
  ): Promise<void> {
    await sqlContainerSyncWatermarkPersistence.ensureSchema(execSql);
    const { laneId, laneKind } = laneKey(lane);
    const updatedAt = new Date().toISOString();
    const row = {
      laneId,
      laneKind,
      watermarkId: watermark.id,
      watermarkUpdatedAt: watermark.updatedAt,
      updatedAt,
    };

    await getAppDatabaseRuntime(execSql).runMutation(async (db) => {
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

    await getAppDatabaseRuntime(execSql).runMutation(async (db) => {
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
