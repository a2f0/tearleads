import { useMemo } from "react";
import {
  createExplorerDocumentReadModelFromRuntime,
  createExplorerWorkflowSqlRuntime,
  type ExplorerDocumentReadModel,
  type ExplorerWorkflowRuntimeInput,
} from "../../workflows/explorer";

export type {
  ExplorerContainerDocumentSidebarRow,
  ExplorerContainerDocumentTombstone,
  ExplorerContainerItemRow,
  ExplorerContainerItemSort,
  ExplorerContainerItemSortDirection,
  ExplorerContainerItemSortKey,
  ExplorerDocumentLinkInput,
  ExplorerDocumentReadModel,
} from "../../workflows/explorer";

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
