import { type ReactNode, useMemo } from "react";
import type { useAppData } from "../../../data/AppDataProvider";
import type { DocumentSummary } from "../../../data/documents/documentsPersistence";
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
  explorer: ExplorerModelExplorer;
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  modalState: ExplorerPanelState["modalState"];
  openInlineDocument: ExplorerPanelState["openInlineDocument"];
  peerUserId: string | null;
  refreshError: string | null;
  selection: ExplorerSelectionState;
  unlinkDocument: ExplorerDocumentMutationAction;
}

export function useExplorerModel(
  appData: ReturnType<typeof useAppData>,
  explorer: ExplorerModelExplorer,
  setSidebar: (sidebar: ReactNode | null) => void,
  peerUserId: string | null,
): ExplorerModel {
  const { documentLinkProjectionVersion, handleDocumentLinksChanged } =
    useDocumentLinkProjectionVersion();
  const {
    knownDocumentIds,
    linkedContainerIdsByDocumentId,
    mergeDocumentSummaries,
    mergeDocumentSummary,
    documentSummaries,
    documentsByContainerId,
    selection,
    setLinkedContainerIdsForDocument,
  } = useExplorerDocumentViewModel({
    appData,
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
    modalState,
    openInlineDocument,
    selectedDocumentLinkedContainerIds,
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
    unlinkDocument,
  } = useExplorerPanelState({
    appData,
    explorer,
    linkedContainerIdsByDocumentId,
    mergeDocumentSummary,
    documentSummaries,
    documentsByContainerId,
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
    explorer,
    handleRefresh,
    isRefreshing,
    linkedContainerIds: selectedDocumentLinkedContainerIds,
    mergeDocumentSummary,
    modalState,
    openInlineDocument,
    peerUserId,
    refreshError,
    selection,
    unlinkDocument,
  };
}
