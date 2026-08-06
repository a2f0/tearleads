import type {
  ContainerDocumentQueries,
  DocumentSummary,
} from "@tearleads/client-sdk";
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import type { AvatarUrlByContactId } from "../../../document-types/contact/useContactAvatarUrls";
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
import { useExplorerSidebarPanel } from "../sidebar/ExplorerTree";
import type { ExplorerTreeEntry } from "../sidebar/explorerTreeModel";
import type { ExplorerModelExplorer } from "./explorerModelTypes";
import type { ExplorerPanelState } from "./explorerPanelStateTypes";
import { useExplorerContainerTrashActions } from "./useExplorerContainerTrashActions";
import { useExplorerDocumentModalState } from "./useExplorerDocumentModalState";
import { useExplorerOrganizationNames } from "./useExplorerOrganizationNames";
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
  appData: RuntimeSnapshot;
  documentLinkProjectionVersion: number;
  documentLinkProjectionVersionByContainerId: ReadonlyMap<string, number>;
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  contactAvatarUrlByLocalId: AvatarUrlByContactId;
  currentSelfContactLocalId: string | null;
  explorer: ExplorerModelExplorer;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  bumpDocumentListRevision: () => void;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
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
  // Re-attempts the SQLite worker boot; forwarded to the sidebar tree's gate.
  onRetryDatabase: () => void;
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
    documentLinkProjectionVersion,
    documentLinkProjectionVersionByContainerId,
    documentListRevision,
    documentQueries,
    contactAvatarUrlByLocalId,
    currentSelfContactLocalId,
    explorer,
    linkedContainerIdsByDocumentId,
    bumpDocumentListRevision,
    loadDocumentSummary,
    loadOrphanedDocumentSummary,
    loadRouteDocumentSummary,
    mergeDocumentSummary,
    documentSummaries,
    onDocumentLinksChanged,
    onRetryDatabase,
    canShareWithPeer,
    peerUserId,
    primaryOrganizationId,
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
    loadDocumentSummary: loadRouteDocumentSummary,
    nodes: explorer.nodes,
    selectDocument: selection.selectDocument,
    setSelectedId: selection.setSelectedId,
  });
  const loadActiveRouteDocumentSummary = useCallback(
    (localId: string) => {
      const route = routeState.route;
      if (
        route.view !== "document-selection" &&
        route.view !== "document-info"
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
  const sidebarOrganizationNamesById = useExplorerOrganizationNames({
    listLocalOrganizations,
    nodes: explorer.nodes,
    primaryOrganizationId,
    ready: explorer.ready,
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
    selectDocument,
    setSelectedId: routeState.selectExplorerItem,
  });
  const contextMenuState = useExplorerContextMenu(
    explorer.nodes,
    routeState.selectExplorerItem,
    selectDocumentProjection,
    rulesContext,
    explorer.trashContainerId,
    explorer.trashSystemSlot,
  );
  useExplorerSidebarPanel({
    activeContainerId: selection.activeContainerId,
    collapsedIds: selection.collapsedIds,
    contactAvatarUrlByLocalId,
    currentSigningFingerprint: appData.crypto.signingFingerprint,
    currentSelfContactLocalId,
    currentUserId: appData.auth.userId,
    currentOrganizationId: appData.auth.organizationId ?? null,
    // Derived from the same worker status as Explorer's detail gate so both show
    // the boot error together; the retry callback is threaded from Explorer.
    databaseError: appData.infra.dbStatus === "error",
    documentLinkProjectionVersion,
    documentLinkProjectionVersionByContainerId,
    documentListRevision,
    documentQueries,
    handleSidebarDocumentContextMenu:
      contextMenuState.handleSidebarDocumentContextMenu,
    handleSidebarContextMenu: contextMenuState.handleSidebarContextMenu,
    nodes: explorer.nodes,
    onRetryDatabase,
    organizationNamesById: sidebarOrganizationNamesById,
    primaryOrganizationId,
    ready: explorer.ready,
    selectedId: selection.selectedId,
    selectDocumentProjection,
    setSelectedId: routeState.selectExplorerItem,
    setSidebar,
    toggleCollapsed: selection.toggleCollapsed,
    treeEntries,
  });
  // The container trash lifecycle: move-to-trash plus the long-running "Delete
  // Forever" / "Empty Trash" purge run (its own progress + cancel modal).
  const { moveContainerToTrash, purgeRun, startContainerPurge } =
    useExplorerContainerTrashActions({
      appData,
      explorer,
      onSettled: bumpDocumentListRevision,
      selectExplorerItem: routeState.selectExplorerItem,
    });
  const modalState = useExplorerDocumentModalState({
    explorer,
    linkDocument: selectedNoteStructuralState.linkDocument,
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
  const uploadManager = useExplorerUploadManager({ importDroppedFiles });
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
          onDocumentLinksChanged([currentContainerId]);
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
