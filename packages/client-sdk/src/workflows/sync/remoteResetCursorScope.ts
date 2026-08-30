import { and, eq, inArray, like, or } from "drizzle-orm";
import {
  containerSyncLaneChecks,
  containerSyncWatermarks,
} from "../../data/sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../data/sqlite/sqlitePersistenceRuntime";
import { remoteResetBatches } from "./remoteResetBatches";

const CONTAINER_DOCUMENTS_LANE = "container_documents";
const CONTAINER_PARENT_LANE = "container_parent";
const LEGACY_ROOT_LANE_ID = "root";
const LEGACY_PARENT_LANE_PREFIX = "parent:";

interface SyncCursorRow {
  readonly laneId: string;
  readonly laneKind: string;
}

export function isRemoteResetSyncCursor(input: {
  containerIds: ReadonlySet<string>;
  organizationId: string;
  row: SyncCursorRow;
}): boolean {
  if (input.row.laneId.startsWith(`${input.organizationId}:`)) return true;
  if (input.row.laneKind === CONTAINER_DOCUMENTS_LANE) {
    return input.containerIds.has(input.row.laneId);
  }
  if (input.row.laneKind !== CONTAINER_PARENT_LANE) return false;
  if (input.row.laneId === LEGACY_ROOT_LANE_ID) return true;
  return (
    input.row.laneId.startsWith(LEGACY_PARENT_LANE_PREFIX) &&
    input.containerIds.has(
      input.row.laneId.slice(LEGACY_PARENT_LANE_PREFIX.length),
    )
  );
}

export async function clearRemoteResetSyncCursors(input: {
  containerIds: readonly string[];
  organizationId: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const scopedLanePattern = `${input.organizationId}:%`;
  for (const table of [
    containerSyncWatermarks,
    containerSyncLaneChecks,
  ] as const) {
    await input.tx
      .delete(table)
      .where(
        or(
          like(table.laneId, scopedLanePattern),
          and(
            eq(table.laneKind, CONTAINER_PARENT_LANE),
            eq(table.laneId, LEGACY_ROOT_LANE_ID),
          ),
        ),
      )
      .run();
  }
  for (const containerBatch of remoteResetBatches(input.containerIds)) {
    const legacyParentLaneIds = containerBatch.map(
      (containerId) => `${LEGACY_PARENT_LANE_PREFIX}${containerId}`,
    );
    for (const table of [
      containerSyncWatermarks,
      containerSyncLaneChecks,
    ] as const) {
      await input.tx
        .delete(table)
        .where(
          or(
            and(
              eq(table.laneKind, CONTAINER_PARENT_LANE),
              inArray(table.laneId, legacyParentLaneIds),
            ),
            and(
              eq(table.laneKind, CONTAINER_DOCUMENTS_LANE),
              inArray(table.laneId, containerBatch),
            ),
          ),
        )
        .run();
    }
  }
}
