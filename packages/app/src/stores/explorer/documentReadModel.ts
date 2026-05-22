import {
  createContainerDocumentReadModelFromRuntime as createExplorerDocumentReadModelFromRuntime,
  createContainerContentsWorkflowSqlRuntime as createExplorerWorkflowSqlRuntime,
  type ContainerDocumentReadModel as ExplorerDocumentReadModel,
  type ContainerContentsWorkflowRuntimeInput as ExplorerWorkflowRuntimeInput,
} from "@tearleads/client-sdk/workflows/container-contents";
import { useMemo } from "react";

export type {
  ContainerDocumentLinkInput as ExplorerDocumentLinkInput,
  ContainerDocumentObjectSyncState as ExplorerObjectSyncState,
  ContainerDocumentReadModel as ExplorerDocumentReadModel,
  ContainerDocumentSidebarRow as ExplorerContainerDocumentSidebarRow,
  ContainerDocumentTombstone as ExplorerContainerDocumentTombstone,
  ContainerItemRow as ExplorerContainerItemRow,
  ContainerItemSort as ExplorerContainerItemSort,
  ContainerItemSortDirection as ExplorerContainerItemSortDirection,
  ContainerItemSortKey as ExplorerContainerItemSortKey,
} from "@tearleads/client-sdk/workflows/container-contents";

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
