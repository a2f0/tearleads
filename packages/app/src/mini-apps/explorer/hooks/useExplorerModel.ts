import { type ReactNode, useCallback, useMemo } from "react";
import type { useAppData } from "../../../data/AppDataProvider";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/containers";
import type { DocumentSummary } from "../../../data/documents/documentsPersistence";
import { useExplorerContextMenu } from "../context-menu/ExplorerContextMenu";
import type { DocumentContainerProjection } from "../documentProjections";
import {
  buildExplorerTree,
  type ExplorerTreeEntry,
  useExplorerSidebarPanel,
} from "../ExplorerTree";
import { useExplorerModalController } from "../modal/ExplorerModal";
import type { MoveTargetOption } from "../targetOptions";
import type { ContainerNode } from "../types";
import { useDiscoveredDocumentsSync } from "./useDiscoveredDocumentsSync";
import { useDocumentLinkProjectionVersion } from "./useDocumentLinkProjectionVersion";
import { useExplorerDocumentViewModel } from "./useExplorerDocumentViewModel";
import { useExplorerRefreshAction } from "./useExplorerRefreshAction";
import type { ExplorerSelectionState } from "./useExplorerSelection";
import { useInlineDocumentAction } from "./useInlineDocumentAction";
import {
  useSelectDocumentProjection,
  useSelectedDocumentStructuralState,
} from "./useSelectedDocumentStructuralState";

interface ExplorerModelExplorer {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  refresh: () => Promise<boolean>;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

type ExplorerContextMenuModel = ReturnType<typeof useExplorerContextMenu>;
type ExplorerModalModel = ReturnType<typeof useExplorerModalController>;
type ExplorerOpenInlineDocument = ReturnType<typeof useInlineDocumentAction>;
type ExplorerDocumentMutationAction = (
  noteId: string,
  targetContainerId: string,
) => Promise<DocumentSummary | null>;

interface ExplorerModel {
  activateLinkedContainer: ExplorerDocumentMutationAction;
  canActivateSelectedDocument: boolean;
  canLinkSelectedDocument: boolean;
  canMoveSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  contextMenuState: ExplorerContextMenuModel;
  explorer: ExplorerModelExplorer;
  handleRefresh: () => Promise<void>;
  isRefreshing: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  modalState: ExplorerModalModel;
  openInlineDocument: ExplorerOpenInlineDocument;
  peerUserId: string | null;
  refreshError: string | null;
  selection: ExplorerSelectionState;
  unlinkDocument: ExplorerDocumentMutationAction;
}

function useExplorerDocumentModalState(params: {
  explorer: ExplorerModelExplorer;
  linkDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  moveDocument: (
    noteId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  peerUserId: string | null;
  setSelectedId: (id: string | null) => void;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  selectionExpandNode: (nodeId: string) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}) {
  const {
    explorer,
    linkDocument,
    moveDocument,
    documentSummaries,
    peerUserId,
    setSelectedId,
    selectedDocumentLinkedContainerIds,
    selectionExpandNode,
    shareWithUser,
  } = params;

  return useExplorerModalController({
    createChild: explorer.createChild,
    deleteContainer: explorer.deleteContainer,
    expandNode: selectionExpandNode,
    linkDocument,
    moveContainer: explorer.moveContainer,
    moveDocument,
    nodes: explorer.nodes,
    documentSummaries,
    peerUserId,
    renameContainer: explorer.renameContainer,
    selectedDocumentLinkedContainerIds,
    setSelectedId,
    shareWithUser,
  });
}

function useExplorerInteractionState(params: {
  activeContainerId: string | null;
  appData: ReturnType<typeof useAppData>;
  explorer: ExplorerModelExplorer;
  knownDocumentIds: ReadonlySet<string>;
  mergeDocumentSummaries: (
    nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => void;
  onDocumentLinksChanged: () => void;
}) {
  const {
    activeContainerId,
    appData,
    explorer,
    knownDocumentIds,
    mergeDocumentSummaries,
    onDocumentLinksChanged,
  } = params;
  const replaceDocumentLinksBatch = useCallback(
    async (
      inputs: ReadonlyArray<{
        containerIds: ReadonlyArray<string>;
        documentId: string;
      }>,
    ) => {
      await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
        appData.execSql,
        inputs,
      );
      onDocumentLinksChanged();
    },
    [appData.execSql, onDocumentLinksChanged],
  );
  const { primeDiscoveredDocuments } = useDiscoveredDocumentsSync({
    activeContainerId,
    appData,
    knownDocumentIds,
    mergeDocumentSummaries,
    replaceDocumentLinksBatch,
  });

  return useExplorerRefreshAction({
    appData,
    mergeDocumentSummaries,
    primeDiscoveredDocuments,
    replaceDocumentLinksBatch,
    refresh: explorer.refresh,
  });
}

function useExplorerPanelState(params: {
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
}) {
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
  const contextMenuState = useExplorerContextMenu(
    explorer.nodes,
    selection.setSelectedId,
  );
  const selectedNoteStructuralState = useSelectedDocumentStructuralState({
    appData,
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
    setSelectedId: selection.setSelectedId,
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
    setSelectedId: selection.setSelectedId,
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
    setSelectedId: selection.setSelectedId,
    selectedDocumentLinkedContainerIds:
      selectedNoteStructuralState.selectedDocumentLinkedContainerIds,
    selectionExpandNode: selection.expandNode,
    shareWithUser: explorer.shareWithUser,
  });
  const openInlineDocument = useInlineDocumentAction({
    expandNode: selection.expandNode,
    mergeDocumentSummary,
    setSelectedId: selection.setSelectedId,
  });
  return {
    activateLinkedContainer: selectedNoteStructuralState.activateLinkedDocument,
    contextMenuState,
    modalState,
    openInlineDocument,
    selectedDocumentLinkedContainerIds:
      selectedNoteStructuralState.selectedDocumentLinkedContainerIds,
    selectedDocumentLinkTargetOptions:
      selectedNoteStructuralState.selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions:
      selectedNoteStructuralState.selectedDocumentMoveTargetOptions,
    unlinkDocument: selectedNoteStructuralState.unlinkDocument,
  };
}

function getSelectedDocumentMutationState(params: {
  appData: ReturnType<typeof useAppData>;
  selectedDocument: DocumentSummary | undefined;
  selectedDocumentLinkTargetOptions: ReadonlyArray<MoveTargetOption>;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  selectedDocumentMoveTargetOptions: ReadonlyArray<MoveTargetOption>;
}) {
  const {
    appData,
    selectedDocument,
    selectedDocumentLinkTargetOptions,
    selectedDocumentLinkedContainerIds,
    selectedDocumentMoveTargetOptions,
  } = params;
  const canActivateSelectedDocument =
    appData.dbStatus === "ready" && !!selectedDocument?.documentId;
  const canMutateSelectedDocument =
    canActivateSelectedDocument && appData.isAuthenticated && appData.online;

  return {
    canActivateSelectedDocument,
    canLinkSelectedDocument:
      canMutateSelectedDocument && selectedDocumentLinkTargetOptions.length > 0,
    canMoveSelectedDocument:
      canMutateSelectedDocument && selectedDocumentMoveTargetOptions.length > 0,
    canUnlinkSelectedDocument:
      canMutateSelectedDocument &&
      selectedDocumentLinkedContainerIds.length > 1,
  };
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
