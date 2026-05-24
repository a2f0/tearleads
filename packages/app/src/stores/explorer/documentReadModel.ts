import type { ContainerDocumentReadModel } from "@tearleads/client-sdk/workflows/container-contents";
import { useMemo } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";

interface ExplorerDocumentReadModelRuntimeState {
  dbStatus: string;
  domainScope: object;
}

export type ExplorerDocumentReadModel = ContainerDocumentReadModel;

export type {
  ContainerDocumentObjectSyncState as ExplorerObjectSyncState,
  ContainerDocumentSidebarRow as ExplorerContainerDocumentSidebarRow,
  ContainerItemRow as ExplorerContainerItemRow,
  ContainerItemSort as ExplorerContainerItemSort,
  ContainerItemSortDirection as ExplorerContainerItemSortDirection,
  ContainerItemSortKey as ExplorerContainerItemSortKey,
} from "@tearleads/client-sdk/workflows/container-contents";

export function useExplorerDocumentReadModel(
  appData: ExplorerDocumentReadModelRuntimeState,
): ExplorerDocumentReadModel {
  const { containerContents } = useTearleads();

  return useMemo(
    () => containerContents.documentReadModel(),
    [appData.dbStatus, appData.domainScope, containerContents],
  );
}
