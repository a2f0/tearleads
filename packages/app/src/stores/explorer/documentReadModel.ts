import type { TearleadsWorkflowRuntimeInput } from "@tearleads/client-sdk";
import {
  type ContainerDocumentReadModel,
  createContainerContentsWorkflowSqlRuntime,
  createContainerDocumentReadModelFromRuntime,
} from "@tearleads/client-sdk/workflows/container-contents";
import { useMemo } from "react";

export type ExplorerDocumentReadModel = ContainerDocumentReadModel;

export type {
  ContainerDocumentLinkInput as ExplorerDocumentLinkInput,
  ContainerDocumentObjectSyncState as ExplorerObjectSyncState,
  ContainerDocumentSidebarRow as ExplorerContainerDocumentSidebarRow,
  ContainerDocumentTombstone as ExplorerContainerDocumentTombstone,
  ContainerItemRow as ExplorerContainerItemRow,
  ContainerItemSort as ExplorerContainerItemSort,
  ContainerItemSortDirection as ExplorerContainerItemSortDirection,
  ContainerItemSortKey as ExplorerContainerItemSortKey,
} from "@tearleads/client-sdk/workflows/container-contents";

export function useExplorerDocumentReadModel(
  appData: Pick<TearleadsWorkflowRuntimeInput, "execSql">,
): ExplorerDocumentReadModel {
  return useMemo(
    () =>
      createContainerDocumentReadModelFromRuntime(
        createContainerContentsWorkflowSqlRuntime({ execSql: appData.execSql }),
      ),
    [appData.execSql],
  );
}
