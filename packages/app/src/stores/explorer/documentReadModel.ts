import {
  createContainerDocumentReadModelFromRuntime as createExplorerDocumentReadModelFromRuntime,
  createContainerDocumentsWorkflowSqlRuntime as createExplorerWorkflowSqlRuntime,
  type ContainerDocumentReadModel as ExplorerDocumentReadModel,
  type ContainerDocumentsWorkflowRuntimeInput as ExplorerWorkflowRuntimeInput,
} from "@tearleads/client-sdk/workflows/container-documents";
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
} from "@tearleads/client-sdk/workflows/container-documents";

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
