import type { MouseEvent, ReactNode } from "react";
import { useCallback } from "react";
import type { DocumentSummary } from "../../../data/documentSummary";
import type { useAppData } from "../../../providers/data/AppDataProvider";
import {
  type ExplorerContainerInfo,
  loadExplorerContainerInfo,
} from "../../../stores/explorer/containerInfo";
import { useExplorerDocumentsRuntimeAppData } from "../../../stores/explorer/documentRuntime";
import {
  type ContextMenuState,
  useExplorerContextMenu,
} from "../context-menu/ExplorerContextMenu";
import type { DocumentContainerProjection } from "../documentProjections";
import type { ExplorerTreeEntry } from "../ExplorerTree";
import { useExplorerSidebarPanel } from "../ExplorerTree";
import type { MoveTargetOption } from "../targetOptions";
import type { ContainerNode } from "../types";
import type {
  ExplorerDocumentMutationAction,
  ExplorerModelExplorer,
} from "./explorerModelTypes";
import {
  type ExplorerDocumentModalState,
  useExplorerDocumentModalState,
} from "./useExplorerDocumentModalState";
import { type ExplorerRouteState, useExplorerRoute } from "./useExplorerRoute";
import type { ExplorerSelectionState } from "./useExplorerSelection";
import {
  type OpenInlineDocument,
  useInlineDocumentAction,
} from "./useInlineDocumentAction";
import {
  useSelectDocumentProjection,
  useSelectedDocumentStructuralState,
} from "./useSelectedDocumentStructuralState";

interface ExplorerContextMenuModel {
  canDeleteContextMenuNode: boolean;
  canMoveContextMenuNode: boolean;
  closeContextMenu: () => void;
  contextMenu: ContextMenuState | null;
  contextMenuNode: ContainerNode | undefined;
  handleSidebarContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    nodeId: string,
  ) => void;
}

export interface ExplorerPanelState {
  activateLinkedContainer: ExplorerDocumentMutationAction;
  contextMenuState: ExplorerContextMenuModel;
  loadContainerInfo: (containerId: string) => Promise<ExplorerContainerInfo>;
  modalState: ExplorerDocumentModalState;
  openInlineDocument: OpenInlineDocument;
  routeState: ExplorerRouteState;
  selectDocumentProjection: (noteId: string, containerId: string) => void;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  selectedDocumentLinkTargetOptions: ReadonlyArray<MoveTargetOption>;
  selectedDocumentMoveTargetOptions: ReadonlyArray<MoveTargetOption>;
  unlinkDocument: ExplorerDocumentMutationAction;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The panel hook coordinates sidebar, document, modal, and context-menu state.
export function useExplorerPanelState(params: {
  appData: ReturnType<typeof useAppData>;
  explorer: ExplorerModelExplorer;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  documentsByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<DocumentContainerProjection>
  >;
  onDocumentLinksChanged: () => void;
  peerUserId: string | null;
  selection: ExplorerSelectionState;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
  setSidebar: (sidebar: ReactNode | null) => void;
  treeEntries: ReadonlyArray<ExplorerTreeEntry>;
}): ExplorerPanelState {
  const {
    appData,
    explorer,
    linkedContainerIdsByDocumentId,
    mergeDocumentSummary,
    documentSummaries,
    documentsByContainerId,
    onDocumentLinksChanged,
    peerUserId,
    selection,
    setLinkedContainerIdsForDocument,
    setSidebar,
    treeEntries,
  } = params;
  const explorerDocumentsAppData = useExplorerDocumentsRuntimeAppData(appData);
  const routeState = useExplorerRoute({
    nodes: explorer.nodes,
    setSelectedId: selection.setSelectedId,
  });
  const contextMenuState = useExplorerContextMenu(
    explorer.nodes,
    routeState.selectExplorerItem,
  );
  const loadContainerInfo = useCallback(
    (containerId: string) => {
      const node = explorer.nodes.find(
        (candidate) => candidate.id === containerId,
      );
      return loadExplorerContainerInfo({
        appData,
        containerId,
        parentId: node?.parentId ?? null,
        remoteInfoMode:
          appData.isAuthenticated && appData.online ? "if-synced" : "never",
      });
    },
    [appData, explorer.nodes],
  );
  const selectedNoteStructuralState = useSelectedDocumentStructuralState({
    appData: explorerDocumentsAppData,
    expandNode: selection.expandNode,
    linkedContainerIdsByDocumentId,
    mergeDocumentSummary,
    nodes: explorer.nodes,
    documentSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
    selectedDocument: selection.selectedDocument,
  });
  const selectDocumentProjection = useSelectDocumentProjection({
    activateLinkedDocument: selectedNoteStructuralState.activateLinkedDocument,
    documentSummaries,
    setSelectedId: routeState.selectExplorerItem,
  });
  useExplorerSidebarPanel({
    activeContainerId: selection.activeContainerId,
    collapsedIds: selection.collapsedIds,
    handleSidebarContextMenu: contextMenuState.handleSidebarContextMenu,
    documentsByContainerId,
    nodes: explorer.nodes,
    ready: explorer.ready,
    selectedId: selection.selectedId,
    selectDocumentProjection,
    setSelectedId: routeState.selectExplorerItem,
    setSidebar,
    toggleCollapsed: selection.toggleCollapsed,
    treeEntries,
  });
  const modalState = useExplorerDocumentModalState({
    explorer,
    linkDocument: selectedNoteStructuralState.linkDocument,
    moveDocument: selectedNoteStructuralState.moveDocument,
    documentSummaries,
    peerUserId,
    setSelectedId: routeState.selectExplorerItem,
    selectedDocumentLinkedContainerIds:
      selectedNoteStructuralState.selectedDocumentLinkedContainerIds,
    selectionExpandNode: selection.expandNode,
    shareWithUser: explorer.shareWithUser,
  });
  const openInlineDocument = useInlineDocumentAction({
    expandNode: selection.expandNode,
    mergeDocumentSummary,
    setSelectedId: routeState.selectExplorerItem,
  });
  return {
    activateLinkedContainer: selectedNoteStructuralState.activateLinkedDocument,
    contextMenuState,
    loadContainerInfo,
    modalState,
    openInlineDocument,
    routeState,
    selectDocumentProjection,
    selectedDocumentLinkedContainerIds:
      selectedNoteStructuralState.selectedDocumentLinkedContainerIds,
    selectedDocumentLinkTargetOptions:
      selectedNoteStructuralState.selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions:
      selectedNoteStructuralState.selectedDocumentMoveTargetOptions,
    unlinkDocument: selectedNoteStructuralState.unlinkDocument,
  };
}
