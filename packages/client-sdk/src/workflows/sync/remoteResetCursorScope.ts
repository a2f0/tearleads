import { and, eq, inArray, like } from "drizzle-orm";
import {
  containerSyncLaneChecks,
  containerSyncWatermarks,
} from "../../data/sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../data/sqlite/sqlitePersistenceRuntime";
import { remoteResetBatches } from "./remoteResetBatches";

const CONTAINER_DOCUMENTS_LANE = "container_documents";

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
  return false;
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
      .where(like(table.laneId, scopedLanePattern))
      .run();
  }
  for (const containerBatch of remoteResetBatches(input.containerIds)) {
    for (const table of [
      containerSyncWatermarks,
      containerSyncLaneChecks,
    ] as const) {
      await input.tx
        .delete(table)
        .where(
          and(
            eq(table.laneKind, CONTAINER_DOCUMENTS_LANE),
            inArray(table.laneId, containerBatch),
          ),
        )
        .run();
    }
  }
}
