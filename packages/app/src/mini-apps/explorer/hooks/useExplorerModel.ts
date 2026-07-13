import type {
  ContainerDocumentQueries,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { type ReactNode, useEffect, useMemo } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../../../providers/sdk/useTearleadsSubscription";
import { findCurrentSelfContactLocalId } from "../../../stores/contacts/contactLabels";
import { useContactsStoreForContainer } from "../../../stores/contacts/useContactsStoreForContainer";
import { useExplorerDocumentQueries } from "../../../stores/explorer/documentQueries";
import { EXPLORER_TRASH_CONTAINER_ICON } from "../../../stores/systemContainers";
import {
  canCreateChildContainerByRules,
  canCreateStructuredDocumentInContainerByRules,
  canUploadToContainerByRules,
  canWriteContainerNode,
  createExplorerContainerRulesContext,
} from "../containerRules";
import { buildExplorerTree } from "../explorerTreeModel";
import type {
  ExplorerDocumentMutationAction,
  ExplorerModelExplorer,
} from "./explorerModelTypes";
import type { ExplorerPanelState } from "./explorerPanelStateTypes";
import { getSelectedDocumentMutationState } from "./selectedDocumentMutationState";
import { useDocumentLinkProjectionVersion } from "./useDocumentLinkProjectionVersion";
import { useExplorerContextMenuDocumentState } from "./useExplorerContextMenuDocumentState";
import { useExplorerDocumentViewModel } from "./useExplorerDocumentViewModel";
import { useExplorerInteractionState } from "./useExplorerInteractionState";
import { useExplorerPanelState } from "./useExplorerPanelState";
import { useExplorerPrimarySystemContainers } from "./useExplorerPrimarySystemContainers";
import type { ExplorerSelectionState } from "./useExplorerSelection";

interface ExplorerModel {
  activateLinkedContainer: ExplorerPanelState["activateLinkedContainer"];
  canCreateChildInActiveContainer: boolean;
  canCreateContactInActiveContainer: boolean;
  canCreateStructuredDocumentInActiveContainer: boolean;
  canUploadToActiveContainer: boolean;
  canDeleteContextMenuDocument: boolean;
  canDeleteSelectedDocument: boolean;
  canDownloadContextMenuDocument: boolean;
  canLinkContextMenuDocument: boolean;
  canLinkSelectedDocument: boolean;
  canMoveContextMenuDocument: boolean;
  canMoveSelectedDocument: boolean;
  canMutateDocumentLinks: boolean;
  canPurgeContextMenuDocument: boolean;
  canPurgeSelectedDocument: boolean;
  canShareWithPeer: boolean;
  canUnlinkSelectedDocument: boolean;
  contextMenuState: ExplorerPanelState["contextMenuState"];
  consumeInitialDocumentEditing: ExplorerPanelState["consumeInitialDocumentEditing"];
  deleteDocument: ExplorerPanelState["deleteDocument"];
  purgeDocument: ExplorerPanelState["purgeDocument"];
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  explorer: ExplorerModelExplorer;
  handleOpenCatchup: () => Promise<boolean>;
  handleRefresh: () => Promise<boolean>;
  importDroppedFiles: ExplorerPanelState["importDroppedFiles"];
  isActiveContactsContainer: boolean;
  loadBlobInfo: ExplorerPanelState["loadBlobInfo"];
  isRefreshing: boolean;
  loadContainerInfo: ExplorerPanelState["loadContainerInfo"];
  loadDocumentInfo: ExplorerPanelState["loadDocumentInfo"];
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  markDocumentStartsInEditMode: ExplorerPanelState["markDocumentStartsInEditMode"];
  modalState: ExplorerPanelState["modalState"];
  moveContainerToTrash: ExplorerPanelState["moveContainerToTrash"];
  purgeRun: ExplorerPanelState["purgeRun"];
  organizationNamesById: ExplorerPanelState["organizationNamesById"];
  openInlineDocument: ExplorerPanelState["openInlineDocument"];
  peerUserId: string | null;
  currentSelfContactLocalId: string | null;
  refreshError: string | null;
  routeState: ExplorerPanelState["routeState"];
  selectDocumentProjection: ExplorerPanelState["selectDocumentProjection"];
  selection: ExplorerSelectionState;
  selectedDocumentStartsInEditMode: boolean;
  unlinkDocument: ExplorerDocumentMutationAction;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The model hook aggregates Explorer route, document, modal, and refresh state for the view.
export function useExplorerModel(
  appData: RuntimeSnapshot,
  explorer: ExplorerModelExplorer,
  setSidebar: (sidebar: ReactNode | null) => void,
  canShareWithPeer: boolean,
  peerUserId: string | null,
  // Re-attempts the SQLite worker boot; threaded to the sidebar tree's gate so a
  // boot failure surfaces a Retry there too (the detail panel gets it directly).
  onRetryDatabase: () => void,
): ExplorerModel {
  const {
    documentLinkProjectionVersion,
    documentLinkProjectionVersionByContainerId,
    handleDocumentLinksChanged,
  } = useDocumentLinkProjectionVersion();
  const documentQueries = useExplorerDocumentQueries(appData);
  const {
    bumpDocumentListRevision,
    documentListRevision,
    linkedContainerIdsByDocumentId,
    loadDocumentSummary,
    mergeDocumentSummaries,
    mergeDocumentSummary,
    documentSummaries,
    selection,
    setLinkedContainerIdsForDocument,
  } = useExplorerDocumentViewModel({
    appData,
    documentQueries,
    documentLinkProjectionVersion,
    nodes: explorer.nodes,
  });
  const treeEntries = useMemo(
    () => buildExplorerTree(explorer.nodes),
    [explorer.nodes],
  );
  const { contactsContainerId, primaryOrganizationId } =
    useExplorerPrimarySystemContainers({
      appData,
      contactsSystemSlot: explorer.contactsSystemSlot,
      nodes: explorer.nodes,
      ready: explorer.ready,
    });
  // The Explorer embeds this Contacts store read-only (self-contact lookup); it
  // never removes contacts, so it needs no Trash resolver.
  const contactsStore = useContactsStoreForContainer(contactsContainerId);
  const contactsSnapshot = useTearleadsExternalStoreSnapshot(contactsStore);
  const currentSelfContactLocalId = useMemo(
    () =>
      findCurrentSelfContactLocalId(
        contactsSnapshot.entries,
        appData.auth.userId,
      ),
    [appData.auth.userId, contactsSnapshot.entries],
  );
  const rulesContext = useMemo(
    () =>
      createExplorerContainerRulesContext({
        contactsContainerId,
        contactsSystemSlot: explorer.contactsSystemSlot,
        currentOrganizationId: appData.auth.organizationId ?? null,
        currentSelfContactLocalId,
        currentSigningFingerprint: appData.crypto.signingFingerprint,
        trashSystemSlot: explorer.trashSystemSlot,
      }),
    [
      appData.auth.organizationId,
      appData.crypto.signingFingerprint,
      contactsContainerId,
      currentSelfContactLocalId,
      explorer.contactsSystemSlot,
      explorer.trashSystemSlot,
    ],
  );
  const { handleOpenCatchup, handleRefresh, isRefreshing, refreshError } =
    useExplorerInteractionState({
      activeContainerId: selection.activeContainerId,
      appData,
      explorer,
      mergeDocumentSummaries,
      onDocumentLinksChanged: handleDocumentLinksChanged,
    });
  const {
    activateLinkedContainer,
    canMutateDocumentLinks,
    consumeInitialDocumentEditing,
    contextMenuState,
    deleteDocument,
    importDroppedFiles,
    loadBlobInfo,
    loadContainerInfo,
    loadDocumentInfo,
    markDocumentStartsInEditMode,
    modalState,
    moveContainerToTrash,
    purgeRun,
    organizationNamesById,
    openInlineDocument,
    purgeDocument,
    routeState,
    selectDocumentProjection,
    selectedDocumentStartsInEditMode,
    selectedDocumentLinkedContainerIds,
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
    unlinkDocument,
  } = useExplorerPanelState({
    appData,
    documentLinkProjectionVersion,
    documentLinkProjectionVersionByContainerId,
    documentQueries,
    explorer,
    bumpDocumentListRevision,
    linkedContainerIdsByDocumentId,
    loadDocumentSummary,
    mergeDocumentSummary,
    documentSummaries,
    documentListRevision,
    currentSelfContactLocalId,
    onDocumentLinksChanged: handleDocumentLinksChanged,
    onRetryDatabase,
    canShareWithPeer,
    peerUserId,
    primaryOrganizationId,
    rulesContext,
    selection,
    setLinkedContainerIdsForDocument,
    setSidebar,
    treeEntries,
  });
  const selectedDocumentMutationState = getSelectedDocumentMutationState({
    appData,
    canResolveTrashContainer: explorer.canResolveTrashContainer,
    nodes: explorer.nodes,
    rulesContext,
    selectedDocument: selection.selectedDocument,
    selectedDocumentLinkTargetOptions,
    selectedDocumentLinkedContainerIds,
    selectedDocumentMoveTargetOptions,
    trashContainerId: explorer.trashContainerId,
    trashSystemSlot: explorer.trashSystemSlot,
  });
  const contextMenuDocumentState = useExplorerContextMenuDocumentState({
    appData,
    canResolveTrashContainer: explorer.canResolveTrashContainer,
    contextMenu: contextMenuState.contextMenu,
    documentSummaries,
    linkedContainerIdsByDocumentId,
    nodes: explorer.nodes,
    rulesContext,
    trashContainerId: explorer.trashContainerId,
    trashSystemSlot: explorer.trashSystemSlot,
  });
  const activeContainerNode = useMemo(
    () =>
      selection.activeContainerId
        ? explorer.nodes.find((node) => node.id === selection.activeContainerId)
        : undefined,
    [explorer.nodes, selection.activeContainerId],
  );
  useEffect(() => {
    const node = activeContainerNode;
    const activeSystemSlot = node?.systemSlot ?? null;
    if (
      !appData.auth.isAuthenticated ||
      !activeSystemSlot ||
      !node ||
      node.syncState.status !== "local-only" ||
      (activeSystemSlot !== explorer.contactsSystemSlot &&
        activeSystemSlot !== explorer.trashSystemSlot)
    ) {
      return;
    }

    void explorer
      .ensureSystemContainer(activeSystemSlot, node.name, {
        deferRemoteBootstrap: true,
        ...(activeSystemSlot === explorer.trashSystemSlot
          ? { icon: EXPLORER_TRASH_CONTAINER_ICON }
          : {}),
        skipAdvancedManagedRoot: true,
      })
      .catch(() => undefined);
  }, [
    activeContainerNode,
    appData.auth.isAuthenticated,
    explorer.contactsSystemSlot,
    explorer.ensureSystemContainer,
    explorer.trashSystemSlot,
  ]);
  const canCreateStructuredDocumentInActiveContainer =
    selection.activeContainerId !== null &&
    canCreateStructuredDocumentInContainerByRules(
      rulesContext,
      activeContainerNode,
    );
  const canCreateChildInActiveContainer =
    selection.activeContainerId !== null &&
    canCreateChildContainerByRules(rulesContext, activeContainerNode);
  const canUploadToActiveContainer =
    selection.activeContainerId !== null &&
    canUploadToContainerByRules(rulesContext, activeContainerNode);
  const isActiveContactsContainer =
    selection.activeContainerId !== null &&
    contactsContainerId !== null &&
    selection.activeContainerId === contactsContainerId;
  const canCreateContactInActiveContainer =
    isActiveContactsContainer &&
    activeContainerNode !== undefined &&
    canWriteContainerNode(activeContainerNode);

  return {
    ...selectedDocumentMutationState,
    activateLinkedContainer,
    canCreateChildInActiveContainer,
    canCreateContactInActiveContainer,
    canCreateStructuredDocumentInActiveContainer,
    canUploadToActiveContainer,
    canDeleteContextMenuDocument:
      contextMenuDocumentState.canDeleteContextMenuDocument,
    canDownloadContextMenuDocument:
      contextMenuDocumentState.canDownloadContextMenuDocument,
    canLinkContextMenuDocument:
      contextMenuDocumentState.canLinkContextMenuDocument,
    canMoveContextMenuDocument:
      contextMenuDocumentState.canMoveContextMenuDocument,
    canMutateDocumentLinks,
    canPurgeContextMenuDocument:
      contextMenuDocumentState.canPurgeContextMenuDocument,
    canShareWithPeer,
    consumeInitialDocumentEditing,
    contextMenuState,
    deleteDocument,
    purgeDocument,
    documentListRevision,
    documentQueries,
    documentSummaries,
    currentSelfContactLocalId,
    explorer,
    handleOpenCatchup,
    handleRefresh,
    importDroppedFiles,
    isActiveContactsContainer,
    loadBlobInfo,
    isRefreshing,
    loadContainerInfo,
    loadDocumentInfo,
    loadDocumentSummary,
    linkedContainerIdsByDocumentId,
    markDocumentStartsInEditMode,
    modalState,
    moveContainerToTrash,
    purgeRun,
    organizationNamesById,
    openInlineDocument,
    peerUserId,
    refreshError,
    routeState,
    selectDocumentProjection,
    selection,
    selectedDocumentStartsInEditMode,
    unlinkDocument,
  };
}
