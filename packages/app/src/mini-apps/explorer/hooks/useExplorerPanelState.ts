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
  isExplorerContainerUnderTrash,
  resolveExplorerDeleteTrashTarget,
} from "../../../stores/explorer/ExplorerSystemContainers";
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
  type ExplorerContainerContextMenuVariant,
  type ExplorerContextMenuState,
  useExplorerContextMenu,
} from "../context-menu/ExplorerContextMenu";
import { useExplorerSidebarPanel } from "../ExplorerTree";
import type { ExplorerTreeEntry } from "../explorerTreeModel";
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
  canCreateChildContextMenuNode: boolean;
  canCreateContactContextMenuNode: boolean;
  canCreateStructuredDocumentContextMenuNode: boolean;
  canDeleteContextMenuNode: boolean;
  canMoveContextMenuNode: boolean;
  canPurgeContextMenuNode: boolean;
  canRenameContextMenuNode: boolean;
  canUploadToContextMenuNode: boolean;
  closeContextMenu: () => void;
  containerContextMenuVariant: ExplorerContainerContextMenuVariant;
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
  canMutateDocumentLinks: boolean;
  contextMenuState: ExplorerContextMenuModel;
  deleteDocument: ExplorerDocumentMutationAction;
  importDroppedFiles: ImportExplorerDroppedFiles;
  loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
  loadContainerInfo: (containerId: string) => Promise<ContainerInfo>;
  loadDocumentInfo: (localId: string) => Promise<DocumentInfo>;
  modalState: ExplorerDocumentModalState;
  openInlineDocument: OpenInlineDocument;
  purgeDocument: (
    documentId: string,
    currentContainerId: string,
  ) => Promise<unknown>;
  routeState: ExplorerRouteState;
  selectDocumentProjection: (documentId: string, containerId: string) => void;
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
  canShareWithPeer: boolean;
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
    canShareWithPeer,
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
    loadDocumentSummary,
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
    (documentId: string, containerId: string) => {
      routeState.selectExplorerDocument(documentId, containerId);
    },
    [routeState.selectExplorerDocument],
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
    explorer.trashContainerId,
  );
  useExplorerSidebarPanel({
    activeContainerId: selection.activeContainerId,
    collapsedIds: selection.collapsedIds,
    currentOrganizationId: appData.auth.organizationId,
    currentSigningFingerprint: appData.crypto.signingFingerprint,
    currentUserId: appData.auth.userId,
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
    canShareWithPeer,
    peerUserId,
    rulesContext,
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
    async (documentId: string, currentContainerId: string) => {
      try {
        // Resolve the Trash for the document's OWN organization, not a single
        // global one. A document under another org's shared root must land in
        // that org's Trash — never the viewer's personal Trash. Only the viewer's
        // own Trash may be lazily created (device-first); a foreign org's Trash is
        // never substituted, so an absent one aborts the delete rather than
        // mis-homing the document across orgs.
        const trashResolution = resolveExplorerDeleteTrashTarget({
          containerId: currentContainerId,
          currentOrganizationId: appData.auth.organizationId,
          nodes: explorer.nodes,
          trashSystemSlot: explorer.trashSystemSlot,
        });
        const trashContainerId =
          trashResolution.trashContainerId ??
          (trashResolution.canFallBackToOwnTrash
            ? (await explorer.ensureTrashContainer())?.id
            : undefined);
        // No-op when the document already lives anywhere under trash (the root
        // or a user-created subfolder of it). Without the subtree check, deleting
        // a document inside a trash subfolder would re-home it to the trash root
        // instead of leaving it in place for the user to purge there.
        if (
          !trashContainerId ||
          isExplorerContainerUnderTrash(
            explorer.nodes,
            currentContainerId,
            trashContainerId,
          )
        ) {
          return null;
        }

        const deletedDocument = await selectedNoteStructuralState.moveDocument(
          documentId,
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
      appData.auth.organizationId,
      appData.util.logError,
      explorer.ensureTrashContainer,
      explorer.nodes,
      explorer.trashSystemSlot,
      routeState.selectExplorerItem,
      selectedNoteStructuralState.moveDocument,
    ],
  );
  const purgeDocument = useCallback(
    async (documentId: string, currentContainerId: string) => {
      try {
        // Purge is the inverse of "move to trash": it only permanently destroys
        // a document that is already in trash — the root or any subfolder of it.
        // Resolve the document's OWN org Trash (not the single global viewer one)
        // so an item under a foreign shared org's Trash is still recognized as
        // purgeable. The server enforces the cardinality/authorization gate; this
        // is the usability guard.
        const { trashContainerId } = resolveExplorerDeleteTrashTarget({
          containerId: currentContainerId,
          currentOrganizationId: appData.auth.organizationId,
          nodes: explorer.nodes,
          trashSystemSlot: explorer.trashSystemSlot,
        });
        if (
          !isExplorerContainerUnderTrash(
            explorer.nodes,
            currentContainerId,
            trashContainerId,
          )
        ) {
          return null;
        }

        const purgedDocument =
          await selectedNoteStructuralState.purgeDocument(documentId);
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
      appData.auth.organizationId,
      appData.util.logError,
      bumpDocumentListRevision,
      explorer.nodes,
      explorer.trashSystemSlot,
      onDocumentLinksChanged,
      routeState.selectExplorerItem,
      selectedNoteStructuralState.purgeDocument,
    ],
  );

  return {
    activateLinkedContainer: selectedNoteStructuralState.activateLinkedDocument,
    canMutateDocumentLinks: explorerDocumentLinks.canMutateDocumentLinks,
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
