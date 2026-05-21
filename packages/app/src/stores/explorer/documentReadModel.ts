import {
  createExplorerDocumentReadModelFromRuntime,
  createExplorerWorkflowSqlRuntime,
  type ExplorerDocumentReadModel,
  type ExplorerWorkflowRuntimeInput,
} from "@tearleads/client-sdk/workflows/explorer";
import { useMemo } from "react";

export type {
  ExplorerContainerDocumentSidebarRow,
  ExplorerContainerDocumentTombstone,
  ExplorerContainerItemRow,
  ExplorerContainerItemSort,
  ExplorerContainerItemSortDirection,
  ExplorerContainerItemSortKey,
  ExplorerDocumentLinkInput,
  ExplorerDocumentReadModel,
  ExplorerObjectSyncState,
} from "@tearleads/client-sdk/workflows/explorer";

export function useExplorerDocumentReadModel(
  appData: ExplorerWorkflowRuntimeInput,
): ExplorerDocumentReadModel {
  return useMemo(
    () =>
      createExplorerDocumentReadModelFromRuntime(
        createExplorerWorkflowSqlRuntime({ execSql: appData.execSql }),
      ),
    [appData.execSql],
  );
}
