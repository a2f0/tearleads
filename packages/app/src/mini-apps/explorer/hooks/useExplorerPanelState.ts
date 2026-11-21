import type {
  ContainerDocumentQueries,
  DocumentSummary,
} from "@tearleads/client-sdk";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  type RuntimeSnapshot,
  useTearleads,
} from "../../../providers/sdk/TearleadsProvider";
import { useExplorerBlobInfoLoader } from "../../../stores/explorer/blobInfo";
import { useExplorerContainerInfoLoader } from "../../../stores/explorer/containerInfo";
import {
  useExplorerDocumentAttributionRangesLoader,
  useExplorerDocumentInfoLoader,
} from "../../../stores/explorer/documentInfo";
import { useExplorerDocumentLinks } from "../../../stores/explorer/documentRuntime";
import {
  isExplorerContainerUnderTrash,
  resolveExplorerDeleteTrashTarget,
} from "../../../stores/explorer/ExplorerSystemContainers";
import type { ExplorerRouteDocumentSummaryResult } from "../../../stores/explorer/useExplorerDocumentSummaryState";
import {
  type ExplorerDroppedFileImportLabels,
  type ImportExplorerDroppedFiles,
  useExplorerDroppedFileImport,
} from "../../../stores/explorer/useExplorerDroppedFileImport";
import { useBlobOrganizationNames } from "../../shared/blob-pick/blob-list/useBlobOrganizationNames";
import { useOrganizationNames } from "../../shared/organizations/useOrganizationNames";
import { useExplorerContextMenu } from "../context-menu/ExplorerContextMenu";
import {
  EXPLORER_LABELS,
  getExplorerDroppedFileImportFailureLog,
  getExplorerDroppedFileTooLargeError,
} from "../labels";
import {
  canUploadToContainerIdByRules,
  type ExplorerContainerRulesContext,
} from "../model/containerRules";
import type { ExplorerFolderState } from "../shared/ExplorerFolderStatus";
import { useExplorerSidebarPanel } from "../sidebar/ExplorerTree";
import type { ExplorerTreeEntry } from "../sidebar/explorerTreeModel";
import type { ExplorerModelExplorer } from "./explorerModelTypes";
import type { ExplorerPanelState } from "./explorerPanelStateTypes";
import {
  resolveExplorerTrashDestination,
  useExplorerContainerTrashActions,
  useExplorerSelectionFollowUp,
} from "./useExplorerContainerTrashActions";
import { useExplorerDocumentModalState } from "./useExplorerDocumentModalState";
import { useExplorerRoute } from "./useExplorerRoute";
import type { ExplorerSelectionState } from "./useExplorerSelection";
import { useExplorerUploadManager } from "./useExplorerUploadManager";
import { useInitialDocumentEditing } from "./useInitialDocumentEditing";
import { useInlineDocumentAction } from "./useInlineDocumentAction";
import {
  useSelectDocumentProjection,
  useSelectedDocumentStructuralState,
} from "./useSelectedDocumentStructuralState";

const explorerDroppedFileImportLabels: ExplorerDroppedFileImportLabels = {
  fileImportStoreNotReady: EXPLORER_LABELS.fileImportStoreNotReady,
  getFileImportFailureLog: getExplorerDroppedFileImportFailureLog,
  getFileTooLargeError: getExplorerDroppedFileTooLargeError,
};

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The panel hook coordinates sidebar, document, modal, and context-menu state.
export function useExplorerPanelState(params: {
  folderState: ExplorerFolderState;
  appData: RuntimeSnapshot;
  documentQueries: ContainerDocumentQueries;
  explorer: ExplorerModelExplorer;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  bumpDocumentListRevision: () => void;
  loadDocumentSummary: (
    localId: string,
    sourceContainerId?: string,
  ) => Promise<DocumentSummary | null>;
  loadOrphanedDocumentSummary: (
    localId: string,
  ) => Promise<DocumentSummary | null>;
  loadRouteDocumentSummary: (
    localId: string,
    routeContainerId: string,
  ) => Promise<ExplorerRouteDocumentSummaryResult>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  onDocumentLinksChanged: (changedContainerIds: Iterable<string>) => void;
  canShareWithPeer: boolean;
  peerUserId: string | null;
  primaryOrganizationId: string | null;
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
    documentQueries,
    explorer,
    linkedContainerIdsByDocumentId,
    bumpDocumentListRevision,
    loadDocumentSummary,
    loadOrphanedDocumentSummary,
    loadRouteDocumentSummary,
    mergeDocumentSummary,
    documentSummaries,
    onDocumentLinksChanged,
    canShareWithPeer,
    peerUserId,
    primaryOrganizationId,
    rulesContext,
    selection,
    setLinkedContainerIdsForDocument,
    setSidebar,
    treeEntries,
  } = params;
  const explorerDocumentLinks = useExplorerDocumentLinks();
  const loadContainerInfo = useExplorerContainerInfoLoader({
    appData,
    nodes: explorer.nodes,
  });
  const loadBlobInfo = useExplorerBlobInfoLoader({ appData });
  const loadDocumentInfo = useExplorerDocumentInfoLoader({
    appData,
    documentContainerId: selection.selectedDocument?.containerId,
    documentId: selection.selectedDocument?.documentId,
    documentKind: selection.selectedDocument?.documentKind,
    documentLocalId: selection.selectedDocument?.id,
    documentUpdatedAt: selection.selectedDocument?.updatedAt,
  });
  const loadDocumentAttributionRanges =
    useExplorerDocumentAttributionRangesLoader();
  const routeState = useExplorerRoute({
    knownNodes: explorer.knownNodes,
    ready:
      explorer.ready &&
      params.folderState !== "loading" &&
      params.folderState !== "syncing",
    loadDocumentSummary: loadRouteDocumentSummary,
    logError: appData.util.logError,
    nodes: explorer.nodes,
    selectDocument: selection.selectDocument,
    setSelectedId: selection.setSelectedId,
  });
  const beginSelectionFollowUp = useExplorerSelectionFollowUp({
    route: routeState.route,
    selectedId: selection.selectedId,
    selectExplorerItem: routeState.selectExplorerItem,
  });
  const loadActiveRouteDocumentSummary = useCallback(
    (localId: string) => {
      const route = routeState.route;
      if (
        route.view !== "document-selection" &&
        route.view !== "document-info" &&
        route.view !== "document-history"
      ) {
        return loadDocumentSummary(localId);
      }

      return loadRouteDocumentSummary(localId, route.containerId).then(
        (result) =>
          result.status === "loaded" ? result.documentSummary : null,
      );
    },
    [loadDocumentSummary, loadRouteDocumentSummary, routeState.route],
  );
  const tearleads = useTearleads();
  // Bind + memoize the loader so the resolver hook can depend on a stable
  // reference (a fresh inline closure each render would re-fire its effect).
  const listLocalOrganizations = useCallback(
    () => tearleads.organizations.listLocalOrganizations(),
    [tearleads],
  );
  // The primary organization's roots carry no heading, so its name is not
  // resolved; until it is known, no heading renders either.
  const sidebarOrganizationNamesById = useOrganizationNames({
    excludedOrganizationId: primaryOrganizationId,
    listLocalOrganizations,
    nodes: explorer.nodes,
    ready: explorer.ready && primaryOrganizationId !== null,
  });
  const localOrganizationNamesById = useBlobOrganizationNames({
    listLocalOrganizations,
    ready: explorer.ready,
    scope: appData.state.domainScope,
  });
  const organizationNamesById = useMemo(
    () =>
      new Map([...localOrganizationNamesById, ...sidebarOrganizationNamesById]),
    [localOrganizationNamesById, sidebarOrganizationNamesById],
  );
  const selectedNoteStructuralState = useSelectedDocumentStructuralState({
    appData: explorerDocumentLinks,
    expandNode: selection.expandNode,
    linkedContainerIdsByDocumentId,
    loadDocumentSummary,
    loadOrphanedDocumentSummary,
    mergeDocumentSummary,
    nodes: explorer.nodes,
    documentSummaries,
    onDocumentLinksChanged,
    rulesContext,
    setLinkedContainerIdsForDocument,
    selectedDocument: selection.selectedDocument,
  });
  const selectDocument = useCallback(
    (
      documentId: string,
      containerId: string,
      options: { replace?: boolean | undefined } = {},
    ) => {
      routeState.selectExplorerDocument(documentId, containerId, options);
    },
    [routeState.selectExplorerDocument],
  );
  const selectDocumentProjection = useSelectDocumentProjection({
    activateLinkedDocument: selectedNoteStructuralState.activateLinkedDocument,
    loadDocumentSummary,
    logError: appData.util.logError,
    selectDocument,
    setSelectedId: routeState.selectExplorerItem,
  });
  const contextMenuState = useExplorerContextMenu(
    explorer.nodes,
    routeState.selectExplorerItem,
    rulesContext,
    explorer.trashContainerId,
    explorer.trashSystemSlot,
  );
  useExplorerSidebarPanel({
    activeContainerId: selection.activeContainerId,
    collapsedIds: selection.collapsedIds,
    handleContainerContextMenu: contextMenuState.handleContainerContextMenu,
    organizationNamesById: sidebarOrganizationNamesById,
    primaryOrganizationId,
    folderState: params.folderState,
    selectedId: selection.selectedId,
    setSelectedId: routeState.selectExplorerItem,
    setSidebar,
    toggleCollapsed: selection.toggleCollapsed,
    treeEntries,
  });
  // The banner setter comes from the modal controller built below; the ref
  // keeps this callback stable across renders.
  const backgroundErrorRef = useRef<(message: string | null) => void>(
    () => undefined,
  );
  const reportBackgroundError = useCallback(
    (message: string | null) => backgroundErrorRef.current(message),
    [],
  );
  // The container trash lifecycle: move-to-trash plus the long-running "Delete
  // Forever" / "Empty Trash" purge run (its own progress + cancel modal).
  const { moveContainerToTrash, purgeRun, startContainerPurge } =
    useExplorerContainerTrashActions({
      appData,
      beginSelectionFollowUp,
      explorer,
      onSettled: bumpDocumentListRevision,
      reportBackgroundError,
    });
  const modalState = useExplorerDocumentModalState({
    explorer,
    linkDocument: selectedNoteStructuralState.linkDocument,
    logError: appData.util.logError,
    moveDocument: selectedNoteStructuralState.moveDocument,
    documentSummaries,
    linkedContainerIdsByDocumentId,
    online: appData.state.online,
    canShareWithPeer,
    peerUserId,
    rulesContext,
    setSelectedId: routeState.selectExplorerItem,
    selectionExpandNode: selection.expandNode,
    shareWithUser: explorer.shareWithUser,
    startContainerPurge,
    startEmptyTrash: purgeRun.startEmptyTrash,
  });
  useEffect(() => {
    backgroundErrorRef.current = modalState.setBackgroundActionError;
  }, [modalState.setBackgroundActionError]);
  const initialDocumentEditing = useInitialDocumentEditing();
  const selectedDocumentStartsInEditMode =
    initialDocumentEditing.documentStartsInEditMode(
      selection.selectedDocument?.id,
    );
  const openInlineDocument = useInlineDocumentAction({
    expandNode: selection.expandNode,
    mergeDocumentSummary,
    onCreateDocument: initialDocumentEditing.trackCreatedDocument,
    setSelectedId: routeState.selectCreatedExplorerItem,
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
    (containerId, files, options) => {
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

      return importDroppedFilesUnguarded(containerId, files, options);
    },
    [explorer.nodes, importDroppedFilesUnguarded, rulesContext],
  );
  const uploadManager = useExplorerUploadManager({
    documentQueries,
    domainScope: appData.state.domainScope,
    importDroppedFiles,
  });
  const deleteDocument = useCallback(
    async (documentId: string, currentContainerId: string) => {
      const selectSource = beginSelectionFollowUp();
      try {
        // Resolve the Trash for the document's OWN organization, not a single
        // global one. A document under another org's shared root must land in
        // that org's Trash — never the viewer's personal Trash.
        const trashContainerId = await resolveExplorerTrashDestination({
          containerId: currentContainerId,
          currentOrganizationId: appData.auth.organizationId,
          explorer,
        });
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
          selectSource(currentContainerId);
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
      beginSelectionFollowUp,
      explorer,
      selectedNoteStructuralState.moveDocument,
    ],
  );
  const purgeDocument = useCallback(
    async (documentId: string, currentContainerId: string) => {
      const selectSource = beginSelectionFollowUp();
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

        const purgedDocument = await selectedNoteStructuralState.purgeDocument(
          documentId,
          currentContainerId,
        );
        if (purgedDocument) {
          // The purged document's local row is gone. Bump the document list
          // revision so the open container listing re-queries SQLite and the
          // destroyed row drops out, and signal a link change so the linked-container
          // map refreshes too.
          bumpDocumentListRevision();
          onDocumentLinksChanged([currentContainerId]);
          selectSource(currentContainerId);
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
      beginSelectionFollowUp,
      bumpDocumentListRevision,
      explorer.nodes,
      explorer.trashSystemSlot,
      onDocumentLinksChanged,
      selectedNoteStructuralState.purgeDocument,
    ],
  );
  return {
    activateLinkedContainer: selectedNoteStructuralState.activateLinkedDocument,
    canMutateDocumentLinks: explorerDocumentLinks.canMutateDocumentLinks,
    contextMenuState,
    deleteDocument,
    uploadManager,
    loadBlobInfo,
    loadContainerInfo,
    loadDocumentAttributionRanges,
    loadDocumentInfo,
    loadDocumentSummary: loadActiveRouteDocumentSummary,
    modalState,
    moveContainerToTrash,
    purgeRun,
    openInlineDocument,
    consumeInitialDocumentEditing:
      initialDocumentEditing.consumeInitialDocumentEditing,
    markDocumentStartsInEditMode:
      initialDocumentEditing.markDocumentStartsInEditMode,
    purgeDocument,
    organizationNamesById,
    routeState,
    selectDocumentProjection,
    selectedDocumentLinkedContainerIds:
      selectedNoteStructuralState.selectedDocumentLinkedContainerIds,
    selectedDocumentStartsInEditMode,
    selectedDocumentLinkTargetOptions:
      selectedNoteStructuralState.selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions:
      selectedNoteStructuralState.selectedDocumentMoveTargetOptions,
    unlinkDocument: selectedNoteStructuralState.unlinkDocument,
  };
}
