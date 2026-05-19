import {
  createExplorerDocumentReadModelFromRuntime,
  createExplorerWorkflowSqlRuntime,
  type ExplorerDocumentReadModel,
  type ExplorerWorkflowRuntimeInput,
} from "@tearleads/client-sdk/workflows/explorer/index";
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
} from "@tearleads/client-sdk/workflows/explorer/index";

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
