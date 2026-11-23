import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import { CONTAINER_METADATA_APP_KIND } from "../../../data/persistence/container-contents/containerContentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  readProcessedCursorForSync,
  recordDocumentSyncVerdicts,
  reportDocumentSyncVoids,
} from "../../documents/sync/processedCursor";
import type { WorkflowRuntimeUtilInput } from "../../shared/runtimeInput";

/** The local scope of a container's metadata document. */
export function containerMetadataScope(containerId: string) {
  return { appKind: CONTAINER_METADATA_APP_KIND, localId: containerId };
}

/**
 * The processed cursor a metadata pull may carry, under the same rules as a
 * document's: the running judge reached it, and the version this pull sends
 * still covers the frontier recorded with it.
 */
export async function readContainerMetadataProcessedCursor(
  execSql: ExecSql,
  input: {
    readonly containerId: string;
    readonly documentId: string;
    readonly localVersionVector: string | null;
  },
): Promise<string | undefined> {
  if (input.localVersionVector === null) return undefined;
  return readProcessedCursorForSync(execSql, {
    documentId: input.documentId,
    frontier: input.localVersionVector,
    scope: containerMetadataScope(input.containerId),
  });
}

/**
 * Records a metadata pass's verdicts, and its processed cursor once its pull
 * completes, in the transaction that saves the pass's state, so the cursor
 * never runs ahead of the frontier it describes. A save that loses to a
 * concurrent one commits nothing here, and the next pass judges again.
 */
export function containerMetadataVerdictRecorder(
  containerId: string,
  synced: SyncRemoteDocumentResult,
) {
  let recorded:
    | Awaited<ReturnType<typeof recordDocumentSyncVerdicts>>
    | undefined;
  return {
    commitSideEffect: async (transactionExecSql: ExecSql): Promise<void> => {
      recorded = await recordDocumentSyncVerdicts(transactionExecSql, {
        scope: containerMetadataScope(containerId),
        synced,
      });
    },
    /**
     * Reports each void the committed save first recorded. True when it
     * dropped the cursor, so the next pull goes by version and judges again.
     * A save that never ran the recorder reports nothing.
     */
    settle: (
      logError: WorkflowRuntimeUtilInput["logError"] | undefined,
    ): boolean => {
      if (!recorded) return false;
      reportDocumentSyncVoids(logError, synced, recorded);
      return recorded.cursorCleared;
    },
  };
}
