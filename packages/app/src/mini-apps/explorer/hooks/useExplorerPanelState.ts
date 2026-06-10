import type {
  BlobInfoInput,
  BlobInfoList,
  ContainerDocumentQueries,
  ContainerInfo,
  DocumentInfo,
  DocumentSummary,
} from "@tearleads/client-sdk";
import type { MouseEvent, ReactNode } from "react";
import { useCallback } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { useExplorerBlobInfoLoader } from "../../../stores/explorer/blobInfo";
import { useExplorerContainerInfoLoader } from "../../../stores/explorer/containerInfo";
import { useExplorerDocumentInfoLoader } from "../../../stores/explorer/documentInfo";
import { useExplorerDocumentLinks } from "../../../stores/explorer/documentRuntime";
import {
  type ExplorerDroppedFileImportLabels,
  type ImportExplorerDroppedFiles,
  useExplorerDroppedFileImport,
} from "../../../stores/explorer/useExplorerDroppedFileImport";
import {
  type ExplorerContextMenuState,
  useExplorerContextMenu,
} from "../context-menu/ExplorerContextMenu";
import type { ExplorerTreeEntry } from "../ExplorerTree";
import { useExplorerSidebarPanel } from "../ExplorerTree";
import {
  EXPLORER_LABELS,
  getExplorerDroppedFileImportFailureLog,
  getExplorerDroppedFileTooLargeError,
} from "../labels";
import type { MoveTargetOption } from "../targetOptions";
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
  contextMenu: ExplorerContextMenuState | null;
  handleSidebarDocumentContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    localId: string,
    containerId: string,
  ) => void;
  handleSidebarContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    nodeId: string,
  ) => void;
}

const explorerDroppedFileImportLabels: ExplorerDroppedFileImportLabels = {
  fileImportStoreNotReady: EXPLORER_LABELS.fileImportStoreNotReady,
  getFileImportFailureLog: getExplorerDroppedFileImportFailureLog,
  getFileTooLargeError: getExplorerDroppedFileTooLargeError,
};

export interface ExplorerPanelState {
  activateLinkedContainer: ExplorerDocumentMutationAction;
  contextMenuState: ExplorerContextMenuModel;
  deleteDocument: ExplorerDocumentMutationAction;
  importDroppedFiles: ImportExplorerDroppedFiles;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  loadContainerInfo: (containerId: string) => Promise<ContainerInfo>;
  loadDocumentInfo: (localId: string) => Promise<DocumentInfo>;
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
  appData: RuntimeSnapshot;
  documentLinkProjectionVersion: number;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  explorer: ExplorerModelExplorer;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  documentSummaries: ReadonlyArray<DocumentSummary>;
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
    documentLinkProjectionVersion,
    documentListRevision,
    documentQueries,
    explorer,
    linkedContainerIdsByDocumentId,
    loadDocumentSummary,
    mergeDocumentSummary,
    documentSummaries,
    onDocumentLinksChanged,
    peerUserId,
    selection,
    setLinkedContainerIdsForDocument,
    setSidebar,
    treeEntries,
  } = params;
  const explorerDocumentLinks = useExplorerDocumentLinks(appData);
  const loadContainerInfo = useExplorerContainerInfoLoader({
    appData,
    nodes: explorer.nodes,
  });
  const loadBlobInfo = useExplorerBlobInfoLoader({ appData });
  const loadDocumentInfo = useExplorerDocumentInfoLoader({ appData });
  const routeState = useExplorerRoute({
    nodes: explorer.nodes,
    setSelectedId: selection.setSelectedId,
  });
  const selectedNoteStructuralState = useSelectedDocumentStructuralState({
    appData: explorerDocumentLinks,
    expandNode: selection.expandNode,
    linkedContainerIdsByDocumentId,
    loadDocumentSummary,
    mergeDocumentSummary,
    nodes: explorer.nodes,
    documentSummaries,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
    selectedDocument: selection.selectedDocument,
  });
  const selectDocument = useCallback(
    (noteId: string, containerId: string) => {
      selection.selectDocument(noteId, containerId);
      routeState.showSelectionRoute();
    },
    [routeState.showSelectionRoute, selection.selectDocument],
  );
  const selectDocumentProjection = useSelectDocumentProjection({
    activateLinkedDocument: selectedNoteStructuralState.activateLinkedDocument,
    loadDocumentSummary,
    selectDocument,
    setSelectedId: routeState.selectExplorerItem,
  });
  const contextMenuState = useExplorerContextMenu(
    explorer.nodes,
    routeState.selectExplorerItem,
    selectDocumentProjection,
  );
  useExplorerSidebarPanel({
    activeContainerId: selection.activeContainerId,
    collapsedIds: selection.collapsedIds,
    currentOrganizationId: appData.auth.organizationId,
    documentLinkProjectionVersion,
    documentListRevision,
    documentQueries,
    handleSidebarDocumentContextMenu:
      contextMenuState.handleSidebarDocumentContextMenu,
    handleSidebarContextMenu: contextMenuState.handleSidebarContextMenu,
    nodes: explorer.nodes,
    online: appData.state.online,
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
  const importDroppedFiles = useExplorerDroppedFileImport({
    appData: explorerDocumentLinks,
    documentQueries,
    labels: explorerDroppedFileImportLabels,
    logError: appData.util.logError,
    mergeDocumentSummary,
  });
  const deleteDocument = useCallback(
    async (noteId: string, currentContainerId: string) => {
      try {
        const trashContainerId =
          explorer.trashContainerId ??
          (await explorer.ensureTrashContainer())?.id;
        if (!trashContainerId || trashContainerId === currentContainerId) {
          return null;
        }

        const deletedDocument = await selectedNoteStructuralState.moveDocument(
          noteId,
          trashContainerId,
        );
        if (deletedDocument) {
          routeState.selectExplorerItem(currentContainerId);
        }

        return deletedDocument;
      } catch (error) {
        appData.util.logError("Failed to delete explorer document", error);
        return null;
      }
    },
    [
      appData.util.logError,
      explorer.ensureTrashContainer,
      explorer.trashContainerId,
      routeState.selectExplorerItem,
      selectedNoteStructuralState.moveDocument,
    ],
  );

  return {
    activateLinkedContainer: selectedNoteStructuralState.activateLinkedDocument,
    contextMenuState,
    deleteDocument,
    importDroppedFiles,
    loadBlobInfo,
    loadContainerInfo,
    loadDocumentInfo,
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
