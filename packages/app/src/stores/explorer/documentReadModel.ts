import type {
  TearleadsContainerDocumentObjectSyncState,
  TearleadsContainerDocumentReadModel,
  TearleadsContainerDocumentSidebarRow,
  TearleadsContainerItemRow,
  TearleadsContainerItemSort,
  TearleadsContainerItemSortDirection,
  TearleadsContainerItemSortKey,
} from "@tearleads/client-sdk";
import { createContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";

interface ExplorerDocumentReadModelRuntimeState {
  dbStatus: string;
  domainScope: object;
}

export type ExplorerDocumentReadModel = TearleadsContainerDocumentReadModel;

export type ExplorerObjectSyncState = TearleadsContainerDocumentObjectSyncState;
export type ExplorerContainerDocumentSidebarRow =
  TearleadsContainerDocumentSidebarRow;
export type ExplorerContainerItemRow = TearleadsContainerItemRow;
export type ExplorerContainerItemSort = TearleadsContainerItemSort;
export type ExplorerContainerItemSortDirection =
  TearleadsContainerItemSortDirection;
export type ExplorerContainerItemSortKey = TearleadsContainerItemSortKey;

export {
  createContainerDocumentObjectSyncState as createExplorerObjectSyncState,
};

export function useExplorerDocumentReadModel(
  appData: ExplorerDocumentReadModelRuntimeState,
): ExplorerDocumentReadModel {
  const { containerContents } = useTearleads();

  return useMemo(
    () => containerContents.documentReadModel(),
    [appData.dbStatus, appData.domainScope, containerContents],
  );
}
