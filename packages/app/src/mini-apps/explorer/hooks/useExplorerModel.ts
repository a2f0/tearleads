import type {
  ContainerDocumentQueries,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { type ReactNode, useEffect, useMemo } from "react";
import {
  type AvatarUrlByContactId,
  useContactAvatarUrls,
} from "../../../document-types/contact/useContactAvatarUrls";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../../../providers/sdk/useTearleadsSubscription";
import { findCurrentSelfContactLocalId } from "../../../stores/contacts/contactLabels";
import { useContactsStoreForContainer } from "../../../stores/contacts/useContactsStoreForContainer";
import { useExplorerDocumentQueries } from "../../../stores/explorer/documentQueries";
import {
  EXPLORER_TRASH_CONTAINER_ICON,
  isContactsSystemContainerNode,
} from "../../../stores/systemContainers";
import {
  canCreateChildContainerByRules,
  canCreateStructuredDocumentInContainerByRules,
  canUploadToContainerByRules,
  canWriteContainerNode,
  createExplorerContainerRulesContext,
  hasContainerRules,
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
  activeContainerHasRules: boolean;
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
  contactAvatarUrlByLocalId: AvatarUrlByContactId;
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
  uploadManager: ExplorerPanelState["uploadManager"];
  isActiveContactsContainer: boolean;
  loadBlobInfo: ExplorerPanelState["loadBlobInfo"];
  isRefreshing: boolean;
  loadContainerInfo: ExplorerPanelState["loadContainerInfo"];
  loadDocumentAttributionRanges: ExplorerPanelState["loadDocumentAttributionRanges"];
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
  baseExplorer: ExplorerModelExplorer,
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
    loadOrphanedDocumentSummary,
    loadRouteDocumentSummary,
    mergeDocumentSummaries,
    mergeDocumentSummary,
    nodes,
    documentSummaries,
    selection,
    setLinkedContainerIdsForDocument,
  } = useExplorerDocumentViewModel({
    appData,
    documentQueries,
    documentLinkProjectionVersion,
    nodes: baseExplorer.nodes,
    ready: baseExplorer.ready,
  });
  const explorer = useMemo(
    () =>
      nodes === baseExplorer.nodes ? baseExplorer : { ...baseExplorer, nodes },
    [baseExplorer, nodes],
  );
  const treeEntries = useMemo(
    () => buildExplorerTree(explorer.nodes),
    [explorer.nodes],
  );
  const { contactsContainerId, primaryOrganizationId } =
    useExplorerPrimarySystemContainers({
      appData,
      contactsSystemSlot: explorer.contactsSystemSlot,
      nodes: explorer.nodes,
    });
  // The Explorer embeds this Contacts store read-only (self-contact lookup); it
  // never removes contacts, so it needs no Trash resolver.
  const contactsStore = useContactsStoreForContainer(contactsContainerId);
  const contactsSnapshot = useTearleadsExternalStoreSnapshot(contactsStore);
  // Contact rows across the Explorer show the contact's avatar in place of the
  // document-kind glyph, the same swap the Contacts mini-app's rows make. Only
  // this container's avatar images are loaded; contacts living elsewhere use
  // the shared no-avatar silhouette.
  const contactAvatarUrlByLocalId = useContactAvatarUrls(
    contactsSnapshot.entries,
    appData.infra.blobStore,
  );
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
        builtInSystemContainers: explorer.builtInSystemContainers,
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
      explorer.builtInSystemContainers,
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
    uploadManager,
    loadBlobInfo,
    loadContainerInfo,
    loadDocumentAttributionRanges,
    loadDocumentInfo,
    loadDocumentSummary: loadActiveRouteDocumentSummary,
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
    loadOrphanedDocumentSummary,
    loadRouteDocumentSummary,
    mergeDocumentSummary,
    documentSummaries,
    documentListRevision,
    contactAvatarUrlByLocalId,
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
  const activeContainerHasRules = hasContainerRules(
    rulesContext,
    activeContainerNode,
  );
  // Detect the active Contacts folder by its system slot, not by the
  // primary-org-resolved contactsContainerId: that id is null until an
  // organization id is assigned, so an account created offline and not yet
  // synced would fall through to the greyed standard toolbar instead of the New
  // Contact button. The slot is derived from the signing key and is available
  // offline, mirroring how Trash is detected (see isTrashSystemContainerNode).
  const isActiveContactsContainer = isContactsSystemContainerNode(
    activeContainerNode,
    explorer.contactsSystemSlot,
  );
  const canCreateContactInActiveContainer =
    isActiveContactsContainer &&
    activeContainerNode !== undefined &&
    canWriteContainerNode(activeContainerNode);

  return {
    ...selectedDocumentMutationState,
    activeContainerHasRules,
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
    contactAvatarUrlByLocalId,
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
    uploadManager,
    isActiveContactsContainer,
    loadBlobInfo,
    isRefreshing,
    loadContainerInfo,
    loadDocumentAttributionRanges,
    loadDocumentInfo,
    loadDocumentSummary: loadActiveRouteDocumentSummary,
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
