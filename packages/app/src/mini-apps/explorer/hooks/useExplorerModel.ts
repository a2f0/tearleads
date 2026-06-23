import type {
  ContainerDocumentQueries,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { type ReactNode, useMemo } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { getContactsContainerId } from "../../../stores/contacts/useContactsCriticalNodesBootstrap";
import { useExplorerDocumentQueries } from "../../../stores/explorer/documentQueries";
import { createExplorerContainerRulesContext } from "../containerRules";
import { buildExplorerTree } from "../ExplorerTree";
import type {
  ExplorerDocumentMutationAction,
  ExplorerModelExplorer,
} from "./explorerModelTypes";
import { getSelectedDocumentMutationState } from "./selectedDocumentMutationState";
import { useDocumentLinkProjectionVersion } from "./useDocumentLinkProjectionVersion";
import { useExplorerContextMenuDocumentState } from "./useExplorerContextMenuDocumentState";
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
  canDeleteContextMenuDocument: boolean;
  canDeleteSelectedDocument: boolean;
  canLinkContextMenuDocument: boolean;
  canLinkSelectedDocument: boolean;
  canMoveContextMenuDocument: boolean;
  canMoveSelectedDocument: boolean;
  canMutateDocumentLinks: boolean;
  canPurgeContextMenuDocument: boolean;
  canPurgeSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  contextMenuState: ExplorerPanelState["contextMenuState"];
  deleteDocument: ExplorerPanelState["deleteDocument"];
  purgeDocument: ExplorerPanelState["purgeDocument"];
  documentListRevision: number;
  documentQueries: ContainerDocumentQueries;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  explorer: ExplorerModelExplorer;
  handleRefresh: () => Promise<boolean>;
  importDroppedFiles: ExplorerPanelState["importDroppedFiles"];
  loadBlobInfo: ExplorerPanelState["loadBlobInfo"];
  isRefreshing: boolean;
  loadContainerInfo: ExplorerPanelState["loadContainerInfo"];
  loadDocumentInfo: ExplorerPanelState["loadDocumentInfo"];
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  modalState: ExplorerPanelState["modalState"];
  openInlineDocument: ExplorerPanelState["openInlineDocument"];
  peerUserId: string | null;
  refreshError: string | null;
  routeState: ExplorerPanelState["routeState"];
  selectDocumentProjection: ExplorerPanelState["selectDocumentProjection"];
  selection: ExplorerSelectionState;
  unlinkDocument: ExplorerDocumentMutationAction;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The model hook aggregates Explorer route, document, modal, and refresh state for the view.
export function useExplorerModel(
  appData: RuntimeSnapshot,
  explorer: ExplorerModelExplorer,
  setSidebar: (sidebar: ReactNode | null) => void,
  peerUserId: string | null,
  // Re-attempts the SQLite worker boot; threaded to the sidebar tree's gate so a
  // boot failure surfaces a Retry there too (the detail panel gets it directly).
  onRetryDatabase: () => void,
): ExplorerModel {
  const { documentLinkProjectionVersion, handleDocumentLinksChanged } =
    useDocumentLinkProjectionVersion();
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
  const contactsContainerId = useMemo(
    () => getContactsContainerId(explorer.nodes, explorer.contactsSystemSlot),
    [explorer.contactsSystemSlot, explorer.nodes],
  );
  const rulesContext = useMemo(
    () =>
      createExplorerContainerRulesContext({
        contactsContainerId,
        contactsSystemSlot: explorer.contactsSystemSlot,
        currentOrganizationId: appData.auth.organizationId ?? null,
        trashSystemSlot: explorer.trashSystemSlot,
      }),
    [
      appData.auth.organizationId,
      contactsContainerId,
      explorer.contactsSystemSlot,
      explorer.trashSystemSlot,
    ],
  );
  const { handleRefresh, isRefreshing, refreshError } =
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
    selectedDocumentLinkedContainerIds,
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
    unlinkDocument,
  } = useExplorerPanelState({
    appData,
    documentLinkProjectionVersion,
    documentQueries,
    explorer,
    bumpDocumentListRevision,
    linkedContainerIdsByDocumentId,
    loadDocumentSummary,
    mergeDocumentSummary,
    documentSummaries,
    documentListRevision,
    onDocumentLinksChanged: handleDocumentLinksChanged,
    onRetryDatabase,
    peerUserId,
    rulesContext,
    selection,
    setLinkedContainerIdsForDocument,
    setSidebar,
    treeEntries,
  });
  const selectedDocumentMutationState = getSelectedDocumentMutationState({
    appData,
    canResolveTrashContainer: explorer.canResolveTrashContainer,
    rulesContext,
    selectedDocument: selection.selectedDocument,
    selectedDocumentLinkTargetOptions,
    selectedDocumentLinkedContainerIds,
    selectedDocumentMoveTargetOptions,
    trashContainerId: explorer.trashContainerId,
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
  });

  return {
    activateLinkedContainer,
    ...selectedDocumentMutationState,
    canDeleteContextMenuDocument:
      contextMenuDocumentState.canDeleteContextMenuDocument,
    canLinkContextMenuDocument:
      contextMenuDocumentState.canLinkContextMenuDocument,
    canMoveContextMenuDocument:
      contextMenuDocumentState.canMoveContextMenuDocument,
    canMutateDocumentLinks,
    canPurgeContextMenuDocument:
      contextMenuDocumentState.canPurgeContextMenuDocument,
    contextMenuState,
    deleteDocument,
    purgeDocument,
    documentListRevision,
    documentQueries,
    documentSummaries,
    explorer,
    handleRefresh,
    importDroppedFiles,
    loadBlobInfo,
    isRefreshing,
    loadContainerInfo,
    loadDocumentInfo,
    loadDocumentSummary,
    linkedContainerIdsByDocumentId,
    modalState,
    openInlineDocument,
    peerUserId,
    refreshError,
    routeState,
    selectDocumentProjection,
    selection,
    unlinkDocument,
  };
}
