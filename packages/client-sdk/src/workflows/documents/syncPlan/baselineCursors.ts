import type { PendingUpdateRecord } from "../../../data/persistence/documents/records/documentPersistenceTypes";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { readProcessedCursorForVersion } from "../sync/processedCursor";

/**
 * The processed cursor each queued rotation baseline signs, by update id: the
 * one its source version covers the recorded frontier of, so every update the
 * cursor's pull imported is in the snapshot and the rest were void. The API
 * then asks the baseline to cover only updates committed after the cursor, and
 * an update every reader voids no longer refuses it. A baseline whose source
 * covers no cursor signs none, and must cover every committed update.
 */
export async function resolveBaselineCursors(input: {
  readonly documentId: string;
  readonly execSql?: ExecSql | undefined;
  readonly pendingUpdates: readonly PendingUpdateRecord[];
}): Promise<ReadonlyMap<string, string>> {
  const cursors = new Map<string, string>();
  const { execSql } = input;
  if (!execSql) return cursors;
  for (const update of input.pendingUpdates) {
    if (!update.sourceVersionVector) continue;
    const cursor = await readProcessedCursorForVersion(execSql, {
      documentId: input.documentId,
      version: update.sourceVersionVector,
    });
    if (cursor !== undefined) cursors.set(update.id, cursor);
  }
  return cursors;
}
