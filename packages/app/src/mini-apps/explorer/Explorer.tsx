import type {
  DomainScope,
  OrganizationDirectoryAndGroups,
} from "@tearleads/client-sdk";
import { useCallback, useEffect } from "react";
import {
  MiniAppRoot,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import { usePeerUserId } from "../../components/pane/dual-pane";
import {
  useWindowFileMenuItem,
  useWindowRefreshMenuItem,
} from "../../components/window/WindowMenuContext";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import { useMiniAppRouteSegments } from "../../navigation/AppNavigationProvider";
import { useOrganizationBilling } from "../../providers/billing/BillingProvider";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useAppFeatureFlags } from "../../providers/feature-flags/AppFeatureFlagsProvider";
import { useAppHostConfig } from "../../providers/host/AppHostConfigProvider";
import {
  type RuntimeSnapshot,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useExplorer } from "../../stores/explorer/ExplorerProvider";
import { useMiniAppBusActions } from "../bus";
import { SystemBootstrapGate } from "../SystemBootstrapGate";
import {
  BlobPickProvider,
  useBlobPick,
} from "../shared/blob-pick/BlobPickProvider";
import { ExplorerContextMenuLayer } from "./context-menu/ExplorerContextMenuLayer";
import type { ExplorerAttributionUserLabelResolver } from "./detail/attributionDisplay";
import { ExplorerDetailPanel } from "./detail/ExplorerDetailPanel";
import { useExplorerRoutedChromeActions } from "./ExplorerRoutedChrome";
import { useExplorerDocumentDownload } from "./hooks/useExplorerDocumentDownload";
import { useExplorerModel } from "./hooks/useExplorerModel";
import { useExplorerOrganizationPresentation } from "./hooks/useExplorerOrganizationPresentation";
import { EXPLORER_LABELS } from "./labels";
import { ExplorerModalLayer } from "./modal/view";
import { ExplorerPurgeProgressModal } from "./purge-progress/ExplorerPurgeProgressModal";
import { useExplorerToolbarUpload } from "./toolbar/useExplorerToolbarUpload";
import type { MiniAppWindowPosition } from "./types";
import "./Explorer.css";

// Keep root-tree catch-up once per identity/database scope across responsive
// Explorer remounts; a real scope switch rotates the weakly held marker.
const catchupCompletedScopes = new WeakSet<DomainScope>();

interface ExplorerGrantOrgManagerTarget {
  containerId: string;
  subjectId: string;
  subjectType: "group" | "organization" | "user";
}

function useOpenGrantInOrgManager() {
  const { openMiniApp } = useMiniAppBusActions();

  return useCallback(
    (
      grant: ExplorerGrantOrgManagerTarget,
      position?: MiniAppWindowPosition,
    ) => {
      openMiniApp({
        appId: "org-manager",
        message: {
          appId: "org-manager",
          containerId: grant.containerId,
          subjectId: grant.subjectId,
          subjectType: grant.subjectType,
          type: "open-grant",
        },
        // org-manager derives (and URL-syncs) the grant detail route from this
        // message via openGrantRoute, so we deliberately send no pathSegments —
        // that keeps Explorer from importing org-manager's route formatter and
        // reaching across the mini-app boundary.
        ...(position ? { position } : {}),
      });
    },
    [openMiniApp],
  );
}

type ExplorerModel = ReturnType<typeof useExplorerModel>;
type ExplorerBlobPickState = ReturnType<typeof useBlobPick>;

interface BlobPickPanelProps {
  appData: RuntimeSnapshot;
  billingBlockedOrganizationId: string | null;
  databaseError: boolean;
  model: ExplorerModel;
  readModelProjection: OrganizationDirectoryAndGroups | null;
  readModelRevision: number;
  readModelScope: object | null;
  resolveAttributionUserLabel: ExplorerAttributionUserLabelResolver;
  onOpenGrant: (
    grant: ExplorerGrantOrgManagerTarget,
    position?: MiniAppWindowPosition,
  ) => void;
  onRetryDatabase: () => void;
}

// The detail panel's flag-gated surfaces, grouped so the render below forwards
// them as one spread rather than a growing column of parallel booleans. The
// panel's own props stay flat — this shape exists only for the hand-off.
interface ExplorerDetailPanelFeatureFlags {
  showDocumentEditRanges: boolean;
  showHeaderSyncIndicator: boolean;
  showLinkedDocumentActivationControls: boolean;
}

interface BlobPickPanelRenderParams extends BlobPickPanelProps {
  blobPick: ExplorerBlobPickState;
  featureFlags: ExplorerDetailPanelFeatureFlags;
}

function renderExplorerDetailPanelWithBlobPick(
  params: BlobPickPanelRenderParams,
) {
  const { appData, blobPick, model, onOpenGrant, resolveAttributionUserLabel } =
    params;
  const { routeState } = model;

  return (
    <ExplorerDetailPanel
      activateLinkedContainer={model.activateLinkedContainer}
      attributionUserLabelResolver={resolveAttributionUserLabel}
      blobPickTarget={blobPick.pickTarget}
      blobStore={appData.infra.blobStore}
      billingBlockedOrganizationId={params.billingBlockedOrganizationId}
      databaseError={params.databaseError}
      onRetryDatabase={params.onRetryDatabase}
      canActivateLinkedContainer={appData.infra.dbStatus === "ready"}
      canMutateDocumentLinks={model.canMutateDocumentLinks}
      canShareWithPeer={model.canShareWithPeer}
      contactAvatarUrlByLocalId={model.contactAvatarUrlByLocalId}
      contextTarget={model.contextMenuState.contextMenu?.id ?? null}
      currentOrganizationId={appData.auth.organizationId}
      currentSigningFingerprint={appData.crypto.signingFingerprint}
      currentSelfContactLocalId={model.currentSelfContactLocalId}
      currentUserId={appData.auth.userId}
      documentListRevision={model.documentListRevision}
      documentQueries={model.documentQueries}
      documentSummaries={model.documentSummaries}
      domainScope={appData.state.domainScope}
      uploadManager={model.uploadManager}
      initialEditingSelectedDocument={model.selectedDocumentStartsInEditMode}
      isAuthenticated={appData.auth.isAuthenticated}
      linkedContainerIdsByDocumentId={model.linkedContainerIdsByDocumentId}
      loadBlobInfo={model.loadBlobInfo}
      loadContainerInfo={model.loadContainerInfo}
      loadDocumentAttributionRanges={model.loadDocumentAttributionRanges}
      loadDocumentInfo={model.loadDocumentInfo}
      loadDocumentSummary={model.loadDocumentSummary}
      nodes={model.explorer.nodes}
      online={appData.state.online}
      organizationNamesById={model.organizationNamesById}
      readModelProjection={params.readModelProjection}
      readModelRevision={params.readModelRevision}
      readModelScope={params.readModelScope}
      onCancelBlobPick={blobPick.cancelBlobPick}
      onContainerContextMenu={model.contextMenuState.handleContainerContextMenu}
      onItemContextMenu={model.contextMenuState.handleItemContextMenu}
      openSyncLanesRoute={routeState.openSyncLanesRoute}
      onOpenGrant={onOpenGrant}
      onOpenSyncLaneDetailRoute={routeState.openSyncLaneDetailRoute}
      onPickBlob={blobPick.resolveBlobPick}
      openInlineDocument={model.openInlineDocument}
      onInitialEditingSelectedDocumentConsumed={
        model.consumeInitialDocumentEditing
      }
      openBlobBrowserRoute={routeState.openBlobBrowserRoute}
      openContainerInfoRoute={routeState.openContainerInfoRoute}
      openDocumentInfoRoute={routeState.openDocumentInfoRoute}
      openUploadsRoute={routeState.openUploadsRoute}
      openWriteQueueRoute={routeState.openWriteQueueRoute}
      openWriteQueueEntryRoute={routeState.openWriteQueueEntryRoute}
      peerUserId={model.peerUserId}
      ready={model.explorer.ready}
      refreshError={model.refreshError}
      route={routeState.route}
      selectDocumentProjection={model.selectDocumentProjection}
      selectedNode={model.selection.selectedNode}
      selectedDocument={model.selection.selectedDocument}
      setContainerIcon={model.explorer.setContainerIcon}
      trashSystemSlot={model.explorer.trashSystemSlot}
      setSelectedId={routeState.selectExplorerItem}
      {...params.featureFlags}
      shareWithGroup={model.explorer.shareWithGroup}
      shareWithUser={model.explorer.shareWithUser}
      unlinkDocument={model.unlinkDocument}
      visibleSystemSlots={model.explorer.visibleSystemSlots}
    />
  );
}

// Reads the blob-pick context (so it lives below BlobPickProvider) and renders
// the detail panel with the pick target + resolve/cancel handlers. The document
// rendered inside the panel reads the same context to request a pick.
function ExplorerDetailPanelWithBlobPick(params: BlobPickPanelProps) {
  const blobPick = useBlobPick();
  const {
    documentEditRangesVisible,
    explorerHeaderSyncIndicatorVisible,
    linkedDocumentActivationControlsEnabled,
  } = useAppFeatureFlags();

  return renderExplorerDetailPanelWithBlobPick({
    ...params,
    blobPick,
    featureFlags: {
      showDocumentEditRanges: documentEditRangesVisible,
      showHeaderSyncIndicator: explorerHeaderSyncIndicatorVisible,
      showLinkedDocumentActivationControls:
        linkedDocumentActivationControlsEnabled,
    },
  });
}

export function Explorer() {
  return (
    <SystemBootstrapGate message="Bootstrapping workspace...">
      <ExplorerContent />
    </SystemBootstrapGate>
  );
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Explorer composes the mini-app shell from model state.
function ExplorerContent() {
  const appData = useTearleadsRuntime();
  const billing = useOrganizationBilling();
  // Ask the host shell, not the global router: in a window this is the window's
  // own Back stack, in the routed shell it is browser history.
  const { canGoBack: historyCanGoBack } = useMiniAppRouteSegments("explorer");
  const hostConfig = useAppHostConfig();
  const explorer = useExplorer();
  const { setSidebar } = useWindowSidebar();
  const peerUserId = usePeerUserId();
  // Surface a failed SQLite boot (e.g. an offline reload where the worker/wasm
  // could not load) as an explicit error + Retry in Explorer's gates, rather than
  // an indistinguishable "Loading...". appData.infra.dbStatus mirrors the worker
  // status (workflowRuntime sets it from database.status); "error" = boot failed.
  const { clearWorker } = useDatabase();
  const databaseError = appData.infra.dbStatus === "error";
  const billingBlockedOrganizationId =
    billing.view && !billing.view.canSync
      ? (billing.billing?.organizationId ?? null)
      : null;
  const retryDatabaseBoot = useCallback(() => {
    // A failed boot leaves the database at the terminal "error" status with the
    // worker handle still set, so re-spawning directly would no-op. clearWorker
    // resets it to "idle", from which DatabaseProvider's identity effect
    // re-spawns the worker and re-attempts the boot.
    clearWorker();
  }, [clearWorker]);
  const model = useExplorerModel(
    appData,
    explorer,
    setSidebar,
    hostConfig.profile.features.explorerPeerSharing,
    peerUserId,
    retryDatabaseBoot,
  );
  const { routeState } = model;
  const organizationPresentation = useExplorerOrganizationPresentation({
    appData,
    view: routeState.route.view,
  });
  const catchupScope = appData.state.domainScope;
  useEffect(() => {
    if (
      catchupCompletedScopes.has(catchupScope) ||
      !appData.auth.isAuthenticated ||
      appData.infra.dbStatus !== "ready" ||
      !model.explorer.ready
    ) {
      return;
    }

    if (appData.state.events.length === 0) {
      return;
    }

    catchupCompletedScopes.add(catchupScope);
    void model.handleOpenCatchup();
  }, [
    appData.auth.isAuthenticated,
    appData.infra.dbStatus,
    appData.state.events.length,
    catchupScope,
    model.explorer.ready,
    model.handleOpenCatchup,
  ]);
  const openGrantInOrgManager = useOpenGrantInOrgManager();
  const activeContainerId = model.selection.activeContainerId;
  const openStructuredDocumentGrid = useCallback(() => {
    // The File menu bypasses the context menu, so repeat the same
    // system-container creation gate before routing to the creation panel.
    if (
      activeContainerId &&
      model.canCreateStructuredDocumentInActiveContainer
    ) {
      routeState.openNewStructuredDocumentRoute(activeContainerId);
    }
  }, [
    activeContainerId,
    model.canCreateStructuredDocumentInActiveContainer,
    routeState.openNewStructuredDocumentRoute,
  ]);
  const returnToDocumentFromBlobPick = useCallback(
    (localId: string, containerId: string) => {
      // The blob picker navigates away and remounts the document, discarding its
      // local edit-mode state. "Choose Blob" is only reachable from edit mode, so
      // re-arm edit mode for the returning document — otherwise attaching a blob
      // silently drops the user back to read mode mid-attach.
      model.markDocumentStartsInEditMode(localId);
      routeState.selectExplorerDocument(localId, containerId);
    },
    [model.markDocumentStartsInEditMode, routeState.selectExplorerDocument],
  );
  const toolbarUpload = useExplorerToolbarUpload(model.uploadManager);
  useExplorerRoutedChromeActions({
    historyCanGoBack,
    model,
    openStructuredDocumentGrid,
    triggerUpload: toolbarUpload.triggerUpload,
  });
  const openNewContactDocument = useCallback(
    (containerId: string) => {
      model.openInlineDocument(containerId, "contact");
    },
    [model.openInlineDocument],
  );
  const downloadDocument = useExplorerDocumentDownload({
    blobStore: appData.infra.blobStore,
    loadDocumentInfo: model.loadDocumentInfo,
  });
  useWindowFileMenuItem({
    disabled:
      !model.explorer.ready ||
      !model.canCreateStructuredDocumentInActiveContainer,
    id: "explorer-new-structured-document",
    label: EXPLORER_LABELS.newStructuredDocumentAction,
    onClick: openStructuredDocumentGrid,
    priority: 100,
  });
  useWindowFileMenuItem({
    disabled: !model.explorer.ready,
    id: "explorer-blob-browser",
    label: EXPLORER_LABELS.blobBrowserAction,
    onClick: routeState.openBlobBrowserRoute,
    priority: 110,
  });
  useWindowFileMenuItem({
    id: "explorer-sync-lanes",
    label: EXPLORER_LABELS.syncLanesAction,
    onClick: routeState.openSyncLanesRoute,
    priority: 120,
  });
  useWindowRefreshMenuItem({
    disabled: !model.explorer.ready || model.isRefreshing,
    onRefresh: model.handleRefresh,
    priority: 100,
    refreshing: model.isRefreshing,
  });

  return (
    <MiniAppRoot className="explorer">
      {model.modalState.backgroundActionError && (
        <MiniAppStatus role="alert" tone="error">
          {model.modalState.backgroundActionError}
        </MiniAppStatus>
      )}
      {toolbarUpload.input}
      <BlobPickProvider
        loadBlobInfo={model.loadBlobInfo}
        openBlobBrowserRoute={routeState.openBlobBrowserRoute}
        returnToDocumentRoute={returnToDocumentFromBlobPick}
      >
        <ExplorerDetailPanelWithBlobPick
          appData={appData}
          billingBlockedOrganizationId={billingBlockedOrganizationId}
          databaseError={databaseError}
          model={model}
          readModelProjection={organizationPresentation.projection}
          readModelRevision={organizationPresentation.revision}
          readModelScope={organizationPresentation.scope}
          resolveAttributionUserLabel={
            organizationPresentation.resolveAttributionUserLabel
          }
          onOpenGrant={openGrantInOrgManager}
          onRetryDatabase={retryDatabaseBoot}
        />
      </BlobPickProvider>
      <ExplorerContextMenuLayer
        canCreateChildContextMenuNode={
          model.contextMenuState.canCreateChildContextMenuNode
        }
        canCreateContactContextMenuNode={
          model.contextMenuState.canCreateContactContextMenuNode
        }
        canCreateStructuredDocumentContextMenuNode={
          model.contextMenuState.canCreateStructuredDocumentContextMenuNode
        }
        canEmptyTrashContextMenuNode={
          model.contextMenuState.canEmptyTrashContextMenuNode
        }
        containerContextMenuVariant={
          model.contextMenuState.containerContextMenuVariant
        }
        canDeleteSelectedDocument={model.canDeleteContextMenuDocument}
        canLinkSelectedDocument={model.canLinkContextMenuDocument}
        canMoveToTrashContextMenuNode={
          model.contextMenuState.canMoveToTrashContextMenuNode
        }
        canMoveContextMenuNode={model.contextMenuState.canMoveContextMenuNode}
        canPurgeContextMenuNode={model.contextMenuState.canPurgeContextMenuNode}
        canRenameContextMenuNode={
          model.contextMenuState.canRenameContextMenuNode
        }
        canUploadToContextMenuNode={
          model.contextMenuState.canUploadToContextMenuNode
        }
        canMoveSelectedDocument={model.canMoveContextMenuDocument}
        canPurgeSelectedDocument={model.canPurgeContextMenuDocument}
        canDownloadSelectedDocument={model.canDownloadContextMenuDocument}
        closeContextMenu={model.contextMenuState.closeContextMenu}
        contextMenu={model.contextMenuState.contextMenu}
        deleteDocument={model.deleteDocument}
        downloadDocument={downloadDocument}
        triggerUpload={toolbarUpload.triggerUpload}
        moveContainerToTrash={model.moveContainerToTrash}
        openDocumentInfoRoute={routeState.openDocumentInfoRoute}
        openContainerInfoRoute={routeState.openContainerInfoRoute}
        openCreateChildModal={model.modalState.openCreateChildModal}
        openLinkDocumentModal={model.modalState.openLinkDocumentModal}
        openMoveModal={model.modalState.openMoveModal}
        openMoveDocumentModal={model.modalState.openMoveDocumentModal}
        openNewStructuredDocumentRoute={
          routeState.openNewStructuredDocumentRoute
        }
        openNewContactDocument={openNewContactDocument}
        openEmptyTrashModal={model.modalState.openEmptyTrashModal}
        openPurgeModal={model.modalState.openPurgeModal}
        openRenameModal={model.modalState.openRenameModal}
        purgeDocument={model.purgeDocument}
      />
      <ExplorerModalLayer
        closeModal={model.modalState.closeModal}
        draftName={model.modalState.draftName}
        draftTargetContainerId={model.modalState.draftTargetContainerId}
        handleModalSubmit={model.modalState.handleModalSubmit}
        isSubmittingModal={model.modalState.isSubmittingModal}
        modalError={model.modalState.modalError}
        modalState={model.modalState.modalState}
        moveTargetOptions={model.modalState.moveTargetOptions}
        nameInputRef={model.modalState.nameInputRef}
        peerUserId={model.peerUserId}
        setDraftName={model.modalState.setDraftName}
        setModalError={model.modalState.setModalError}
        setDraftTargetContainerId={model.modalState.setDraftTargetContainerId}
        targetSelectRef={model.modalState.targetSelectRef}
      />
      <ExplorerPurgeProgressModal
        run={model.purgeRun.run}
        onCancel={model.purgeRun.cancel}
        onClose={model.purgeRun.dismiss}
      />
    </MiniAppRoot>
  );
}
