import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import { CONTAINER_METADATA_APP_KIND } from "../../../data/persistence/container-contents/containerContentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  closeDocumentSyncLoroWindowInTransaction,
  type DocumentSyncLoroWindow,
  settleDocumentSyncLoroWindow,
} from "../../documents";
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
  loroWindow: DocumentSyncLoroWindow | null = null,
) {
  let recorded:
    | Awaited<ReturnType<typeof recordDocumentSyncVerdicts>>
    | undefined;
  return {
    commitSideEffect: async (transactionExecSql: ExecSql): Promise<void> => {
      const scope = containerMetadataScope(containerId);
      recorded = await recordDocumentSyncVerdicts(transactionExecSql, {
        scope,
        synced,
      });
      // The page's Loro reads are over and saved: its window closes.
      await closeDocumentSyncLoroWindowInTransaction(transactionExecSql, {
        documentId: synced.plan.documentId,
        scope,
        synced,
        window: loroWindow,
      });
    },
    /**
     * Settles the page's window once its save is over. Only a save that ran
     * the recorder and committed took the window's row away with it; one
     * that lost currency at commit rolled the close back, so the settle
     * deletes the row itself.
     */
    settleWindow: async (
      execSql: ExecSql,
      saved: { readonly committed: boolean },
    ): Promise<void> => {
      if (!loroWindow) return;
      await settleDocumentSyncLoroWindow(
        loroWindow,
        saved.committed && recorded !== undefined ? execSql : null,
      );
    },
    /**
     * Reports each void the committed save first recorded. A save that never
     * ran the recorder reports nothing.
     */
    settle: (
      logError: WorkflowRuntimeUtilInput["logError"] | undefined,
    ): void => {
      if (!recorded) return;
      reportDocumentSyncVoids(logError, synced, recorded);
    },
  };
}
