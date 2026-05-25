import type {
  ContainerDocumentReadModel,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { type ReactNode, useMemo } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { useExplorerDocumentReadModel } from "../../../stores/explorer/documentReadModel";
import { buildExplorerTree } from "../ExplorerTree";
import type {
  ExplorerDocumentMutationAction,
  ExplorerModelExplorer,
} from "./explorerModelTypes";
import { getSelectedDocumentMutationState } from "./selectedDocumentMutationState";
import { useDocumentLinkProjectionVersion } from "./useDocumentLinkProjectionVersion";
import { useExplorerDocumentViewModel } from "./useExplorerDocumentViewModel";
import { useExplorerInteractionState } from "./useExplorerInteractionState";
import {
  type ExplorerPanelState,
  useExplorerPanelState,
} from "./useExplorerPanelState";
import type { ExplorerSelectionState } from "./useExplorerSelection";

interface ExplorerModel {
  activateLinkedContainer: ExplorerDocumentMutationAction;
  canActivateSelectedDocument: boolean;
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  contextMenuState: ExplorerPanelState["contextMenuState"];
  documentListRevision: number;
  documentReadModel: ContainerDocumentReadModel;
  explorer: ExplorerModelExplorer;
  handleRefresh: () => Promise<boolean>;
  importDroppedFiles: ExplorerPanelState["importDroppedFiles"];
  isRefreshing: boolean;
  loadContainerInfo: ExplorerPanelState["loadContainerInfo"];
  loadDocumentInfo: ExplorerPanelState["loadDocumentInfo"];
  linkedContainerIds: ReadonlyArray<string>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  modalState: ExplorerPanelState["modalState"];
  openInlineDocument: ExplorerPanelState["openInlineDocument"];
  peerUserId: string | null;
  refreshError: string | null;
  routeState: ExplorerPanelState["routeState"];
  selectDocumentProjection: ExplorerPanelState["selectDocumentProjection"];
  selection: ExplorerSelectionState;
  unlinkDocument: ExplorerDocumentMutationAction;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The model hook aggregates Explorer route, document, modal, and refresh state for the view.
export function useExplorerModel(
  appData: RuntimeSnapshot,
  explorer: ExplorerModelExplorer,
  setSidebar: (sidebar: ReactNode | null) => void,
  peerUserId: string | null,
): ExplorerModel {
  const { documentLinkProjectionVersion, handleDocumentLinksChanged } =
    useDocumentLinkProjectionVersion();
  const documentReadModel = useExplorerDocumentReadModel(appData);
  const {
    documentListRevision,
    knownDocumentIds,
    linkedContainerIdsByDocumentId,
    loadDocumentSummary,
    mergeDocumentSummaries,
    mergeDocumentSummary,
    documentSummaries,
    selection,
    setLinkedContainerIdsForDocument,
  } = useExplorerDocumentViewModel({
    appData,
    documentReadModel,
    documentLinkProjectionVersion,
    nodes: explorer.nodes,
  });
  const treeEntries = useMemo(
    () => buildExplorerTree(explorer.nodes),
    [explorer.nodes],
  );
  const { handleRefresh, isRefreshing, refreshError } =
    useExplorerInteractionState({
      activeContainerId: selection.activeContainerId,
      appData,
      explorer,
      knownDocumentIds,
      mergeDocumentSummaries,
      onDocumentLinksChanged: handleDocumentLinksChanged,
    });
  const {
    activateLinkedContainer,
    contextMenuState,
    importDroppedFiles,
    loadContainerInfo,
    loadDocumentInfo,
    modalState,
    openInlineDocument,
    routeState,
    selectDocumentProjection,
    selectedDocumentLinkedContainerIds,
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
    unlinkDocument,
  } = useExplorerPanelState({
    appData,
    documentLinkProjectionVersion,
    documentReadModel,
    explorer,
    linkedContainerIdsByDocumentId,
    loadDocumentSummary,
    mergeDocumentSummary,
    documentSummaries,
    documentListRevision,
    onDocumentLinksChanged: handleDocumentLinksChanged,
    peerUserId,
    selection,
    setLinkedContainerIdsForDocument,
    setSidebar,
    treeEntries,
  });
  const selectedDocumentMutationState = getSelectedDocumentMutationState({
    appData,
    selectedDocument: selection.selectedDocument,
    selectedDocumentLinkTargetOptions,
    selectedDocumentLinkedContainerIds,
    selectedDocumentMoveTargetOptions,
  });

  return {
    activateLinkedContainer,
    ...selectedDocumentMutationState,
    contextMenuState,
    documentListRevision,
    documentReadModel,
    explorer,
    handleRefresh,
    importDroppedFiles,
    isRefreshing,
    loadContainerInfo,
    loadDocumentInfo,
    linkedContainerIds: selectedDocumentLinkedContainerIds,
    mergeDocumentSummary,
    modalState,
    openInlineDocument,
    peerUserId,
    refreshError,
    routeState,
    selectDocumentProjection,
    selection,
    unlinkDocument,
  };
}
