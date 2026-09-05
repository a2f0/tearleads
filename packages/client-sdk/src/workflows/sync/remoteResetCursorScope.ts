import { and, eq, inArray, or } from "drizzle-orm";
import {
  containerSyncLaneChecks,
  containerSyncWatermarks,
} from "../../data/sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../data/sqlite/sqlitePersistenceRuntime";
import { remoteResetBatches } from "./remoteResetBatches";

const CONTAINER_DOCUMENTS_LANE = "container_documents";
const CONTAINER_PARENT_LANE = "container_parent";
// The API root feed lists every accessible organization. Its one cursor must
// reset on any organization's purge; child feeds use globally unique IDs.
const ROOT_LANE_ID = "root";
const PARENT_LANE_PREFIX = "parent:";

interface SyncCursorRow {
  readonly laneId: string;
  readonly laneKind: string;
}

export function isRemoteResetSyncCursor(input: {
  containerIds: ReadonlySet<string>;
  row: SyncCursorRow;
}): boolean {
  if (input.row.laneKind === CONTAINER_DOCUMENTS_LANE) {
    return input.containerIds.has(input.row.laneId);
  }
  if (input.row.laneKind !== CONTAINER_PARENT_LANE) return false;
  if (input.row.laneId === ROOT_LANE_ID) return true;
  return (
    input.row.laneId.startsWith(PARENT_LANE_PREFIX) &&
    input.containerIds.has(input.row.laneId.slice(PARENT_LANE_PREFIX.length))
  );
}

export async function clearRemoteResetSyncCursors(input: {
  containerIds: readonly string[];
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  for (const table of [
    containerSyncWatermarks,
    containerSyncLaneChecks,
  ] as const) {
    await input.tx
      .delete(table)
      .where(
        and(
          eq(table.laneKind, CONTAINER_PARENT_LANE),
          eq(table.laneId, ROOT_LANE_ID),
        ),
      )
      .run();
  }
  for (const containerBatch of remoteResetBatches(input.containerIds)) {
    const parentLaneIds = containerBatch.map(
      (containerId) => `${PARENT_LANE_PREFIX}${containerId}`,
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
              inArray(table.laneId, parentLaneIds),
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
