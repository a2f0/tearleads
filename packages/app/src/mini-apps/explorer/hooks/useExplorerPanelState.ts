import type {
  BlobInfoInput,
  BlobInfoList,
  ContainerDocumentQueries,
  ContainerInfo,
  ContainerItemRow,
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
  canUploadToContainerIdByRules,
  type ExplorerContainerRulesContext,
} from "../containerRules";
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
  canRenameContextMenuNode: boolean;
  canUploadToContextMenuNode: boolean;
  closeContextMenu: () => void;
  contextMenu: ExplorerContextMenuState | null;
  handleContainerContextMenu: (
    event: MouseEvent<HTMLElement>,
    nodeId: string,
  ) => void;
  handleItemContextMenu: (
    event: MouseEvent<HTMLElement>,
    row: ContainerItemRow,
  ) => void;
  handleSidebarDocumentContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    localId: string,
    containerId: string,
  ) => void;
  handleSidebarContextMenu: (
    event: MouseEvent<HTMLElement>,
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
  purgeDocument: (
    noteId: string,
    currentContainerId: string,
  ) => Promise<unknown>;
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
  bumpDocumentListRevision: () => void;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  onDocumentLinksChanged: () => void;
  // Re-attempts the SQLite worker boot; forwarded to the sidebar tree's gate.
  onRetryDatabase: () => void;
  peerUserId: string | null;
  rulesContext: ExplorerContainerRulesContext;
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
    bumpDocumentListRevision,
    loadDocumentSummary,
    mergeDocumentSummary,
    documentSummaries,
    onDocumentLinksChanged,
    onRetryDatabase,
    peerUserId,
    rulesContext,
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
    selectDocument: selection.selectDocument,
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
    rulesContext,
    setLinkedContainerIdsForDocument,
    selectedDocument: selection.selectedDocument,
  });
  const selectDocument = useCallback(
    (noteId: string, containerId: string) => {
      selection.selectDocument(noteId, containerId);
      routeState.selectExplorerDocument(noteId, containerId);
    },
    [routeState.selectExplorerDocument, selection.selectDocument],
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
    rulesContext,
  );
  useExplorerSidebarPanel({
    activeContainerId: selection.activeContainerId,
    collapsedIds: selection.collapsedIds,
    currentOrganizationId: appData.auth.organizationId,
    // Derived from the same worker status as Explorer's detail gate so both show
    // the boot error together; the retry callback is threaded from Explorer.
    databaseError: appData.infra.dbStatus === "error",
    documentLinkProjectionVersion,
    documentListRevision,
    documentQueries,
    handleSidebarDocumentContextMenu:
      contextMenuState.handleSidebarDocumentContextMenu,
    handleSidebarContextMenu: contextMenuState.handleSidebarContextMenu,
    nodes: explorer.nodes,
    online: appData.state.online,
    onRetryDatabase,
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
    linkedContainerIdsByDocumentId,
    peerUserId,
    setSelectedId: routeState.selectExplorerItem,
    selectionExpandNode: selection.expandNode,
    shareWithUser: explorer.shareWithUser,
  });
  const openInlineDocument = useInlineDocumentAction({
    expandNode: selection.expandNode,
    mergeDocumentSummary,
    setSelectedId: routeState.selectExplorerItem,
  });
  const importDroppedFilesUnguarded = useExplorerDroppedFileImport({
    appData: explorerDocumentLinks,
    documentQueries,
    labels: explorerDroppedFileImportLabels,
    logError: appData.util.logError,
    mergeDocumentSummary,
  });
  // Enforce the container upload rule on every import path. The context menu
  // already hides "Upload" for protected folders, but drag-and-drop targets the
  // container directly, so the rule has to hold here too — otherwise a drop
  // would bypass the protection and land files in e.g. the Trash. Throwing
  // surfaces the reason in the drop target's import status.
  const importDroppedFiles = useCallback<ImportExplorerDroppedFiles>(
    (containerId, files, onProgress) => {
      if (
        !canUploadToContainerIdByRules(
          rulesContext,
          explorer.nodes,
          containerId,
        )
      ) {
        return Promise.reject(
          new Error(EXPLORER_LABELS.fileImportBlockedByContainer),
        );
      }

      return importDroppedFilesUnguarded(containerId, files, onProgress);
    },
    [explorer.nodes, importDroppedFilesUnguarded, rulesContext],
  );
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
          {
            replaceLinkedContainers: true,
            sourceContainerId: currentContainerId,
          },
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
  const purgeDocument = useCallback(
    async (noteId: string, currentContainerId: string) => {
      try {
        // Purge is the inverse of "move to trash": it only permanently destroys
        // a document that is already in the trash container. The server enforces
        // the cardinality/authorization gate; this is the usability guard.
        if (
          !explorer.trashContainerId ||
          currentContainerId !== explorer.trashContainerId
        ) {
          return null;
        }

        const purgedDocument =
          await selectedNoteStructuralState.purgeDocument(noteId);
        if (purgedDocument) {
          // The purged document's local row is gone. Bump the document list
          // revision so the open container listing re-queries SQLite and the
          // destroyed row drops out, and signal a link change so the sidebar
          // tree and linked-container map refresh too.
          bumpDocumentListRevision();
          onDocumentLinksChanged();
          routeState.selectExplorerItem(currentContainerId);
        }

        return purgedDocument;
      } catch (error) {
        appData.util.logError("Failed to purge explorer document", error);
        return null;
      }
    },
    [
      appData.util.logError,
      bumpDocumentListRevision,
      explorer.trashContainerId,
      onDocumentLinksChanged,
      routeState.selectExplorerItem,
      selectedNoteStructuralState.purgeDocument,
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
    purgeDocument,
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
