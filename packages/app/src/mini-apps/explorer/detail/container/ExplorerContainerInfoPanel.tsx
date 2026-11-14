import type { ContainerInfo, ContainerNode } from "@tearleads/client-sdk";
import { type ReactNode, useId } from "react";
import {
  MiniAppFormPanel,
  MiniAppStatus,
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
} from "../../../../components/mini-app/MiniAppLayout";
import { EXPLORER_LABELS } from "../../labels";
import type { MiniAppWindowPosition } from "../../types";
import type { ExplorerAttributionUserLabelResolver } from "../attributionDisplay";
import {
  ExplorerContainerInfoActions,
  ExplorerContainerInfoHeader,
  ExplorerContainerInfoSharingProgress,
} from "./ExplorerContainerInfoChrome";
import { ExplorerContainerInfoLocalSection } from "./ExplorerContainerInfoLocalSection";
import { ExplorerContainerInfoSecuritySection } from "./ExplorerContainerInfoSecuritySection";
import {
  ExplorerContainerInfoNewShareSection,
  ExplorerContainerInfoPeerShareSection,
  ExplorerContainerInfoPrincipalGrantsSection,
} from "./ExplorerContainerInfoSharingSections";
import { ExplorerContainerInfoSyncCursorsSection } from "./ExplorerContainerInfoSyncCursorsSection";
import {
  type ContainerInfoTabId,
  type ExplorerContainerInfoPanelProps,
  type ExplorerContainerInfoShareDraft,
  useExplorerContainerInfoPanelState,
} from "./useExplorerContainerInfoPanelState";

const CONTAINER_INFO_TABS: ReadonlyArray<
  MiniAppTabDescriptor<ContainerInfoTabId>
> = [
  { id: "general", label: EXPLORER_LABELS.containerInfoGeneralTab },
  { id: "sharing", label: EXPLORER_LABELS.containerInfoSharingTab },
  { id: "security", label: EXPLORER_LABELS.containerInfoSecurityTab },
  { id: "sync", label: EXPLORER_LABELS.containerInfoSyncTab },
];

function ExplorerContainerInfoTabs(params: {
  activeTab: ContainerInfoTabId;
  idPrefix: string;
  setActiveTab: (tab: ContainerInfoTabId) => void;
}) {
  return (
    <MiniAppTabList
      activeTab={params.activeTab}
      idPrefix={params.idPrefix}
      label={EXPLORER_LABELS.containerInfoTabsLabel}
      onSelect={params.setActiveTab}
      tabs={CONTAINER_INFO_TABS}
    />
  );
}

function ContainerInfoRemoteStatus(params: {
  containerInfo: ContainerInfo | null;
  containerInfoError: string | null;
  isLoadingContainerInfo: boolean;
}) {
  if (params.isLoadingContainerInfo && !params.containerInfo) {
    return (
      <MiniAppStatus>{EXPLORER_LABELS.containerInfoLoading}</MiniAppStatus>
    );
  }

  if (params.containerInfoError) {
    return (
      <MiniAppStatus tone="error">{params.containerInfoError}</MiniAppStatus>
    );
  }

  return null;
}

function ExplorerContainerInfoSharingSections(params: {
  containerNamesById: ReadonlyMap<string, string>;
  canShareContainer: boolean;
  canShareWithPeer: boolean;
  isSubmitting: boolean;
  onOpenGrant: (
    grant: {
      containerId: string;
      subjectId: string;
      subjectType: "group" | "user";
    },
    position?: MiniAppWindowPosition,
  ) => void;
  onShareWithPeer: () => void;
  peerUserId: string | null;
  remoteInfo: NonNullable<ContainerInfo["remoteInfo"]>;
  resolveUserLabel: ExplorerAttributionUserLabelResolver | undefined;
  setPanelError: (error: string | null) => void;
  shareDraft: ExplorerContainerInfoShareDraft;
}) {
  const showPeerShare =
    params.canShareContainer &&
    params.canShareWithPeer &&
    params.peerUserId !== null;

  return (
    <>
      <ExplorerContainerInfoPrincipalGrantsSection
        containerNamesById={params.containerNamesById}
        remoteInfo={params.remoteInfo}
        onOpenGrant={params.onOpenGrant}
        resolveUserLabel={params.resolveUserLabel}
      />
      {params.canShareContainer ? (
        <ExplorerContainerInfoNewShareSection
          isSubmitting={params.isSubmitting}
          setPanelError={params.setPanelError}
          shareDraft={params.shareDraft}
        />
      ) : null}
      {showPeerShare ? (
        <ExplorerContainerInfoPeerShareSection
          isSubmitting={params.isSubmitting}
          onShareWithPeer={params.onShareWithPeer}
        />
      ) : null}
    </>
  );
}

// Remote-only tabs say so once loading settles without an error and the
// container still has no remote info.
function ExplorerContainerInfoNoRemoteInfo(params: {
  activeTab: ContainerInfoTabId;
  containerInfoError: string | null;
  hasRemoteInfo: boolean;
  isLoadingContainerInfo: boolean;
}) {
  if (
    params.activeTab === "general" ||
    params.hasRemoteInfo ||
    params.isLoadingContainerInfo ||
    params.containerInfoError
  ) {
    return null;
  }
  return (
    <MiniAppStatus>{EXPLORER_LABELS.containerInfoNoRemoteInfo}</MiniAppStatus>
  );
}

function ExplorerContainerInfoTabPanel(params: {
  activeTab: ContainerInfoTabId;
  canManageIcon: boolean;
  containerIcon: string | null;
  containerId: string;
  containerInfo: ContainerInfo | null;
  containerInfoError: string | null;
  containerNamesById: ReadonlyMap<string, string>;
  canShareContainer: boolean;
  canShareWithPeer: boolean;
  idPrefix: string;
  isLoadingContainerInfo: boolean;
  isSubmitting: boolean;
  onOpenGrant: (
    grant: {
      containerId: string;
      subjectId: string;
      subjectType: "group" | "user";
    },
    position?: MiniAppWindowPosition,
  ) => void;
  onShareWithPeer: () => void;
  peerUserId: string | null;
  primaryDocumentSettings: ReactNode;
  resolveUserLabel: ExplorerAttributionUserLabelResolver | undefined;
  setContainerIcon: (
    containerId: string,
    icon: string | null,
  ) => Promise<ContainerNode | null>;
  setPanelError: (error: string | null) => void;
  shareDraft: ExplorerContainerInfoShareDraft;
}) {
  const remoteInfo = params.containerInfo?.remoteInfo ?? null;

  return (
    <MiniAppTabPanel
      activeTab={params.activeTab}
      className="explorer-info-tab-panel"
      idPrefix={params.idPrefix}
    >
      {params.activeTab === "general" ? (
        <ExplorerContainerInfoLocalSection
          canManageIcon={params.canManageIcon}
          containerIcon={params.containerIcon}
          containerId={params.containerId}
          containerInfo={params.containerInfo}
          setContainerIcon={params.setContainerIcon}
        />
      ) : null}
      <div hidden={params.activeTab !== "general"}>
        {params.primaryDocumentSettings}
      </div>
      <ExplorerContainerInfoNoRemoteInfo
        activeTab={params.activeTab}
        containerInfoError={params.containerInfoError}
        hasRemoteInfo={remoteInfo !== null}
        isLoadingContainerInfo={params.isLoadingContainerInfo}
      />
      {params.activeTab === "sharing" && remoteInfo ? (
        <ExplorerContainerInfoSharingSections
          containerNamesById={params.containerNamesById}
          canShareContainer={params.canShareContainer}
          canShareWithPeer={params.canShareWithPeer}
          isSubmitting={params.isSubmitting}
          remoteInfo={remoteInfo}
          onOpenGrant={params.onOpenGrant}
          onShareWithPeer={params.onShareWithPeer}
          peerUserId={params.peerUserId}
          resolveUserLabel={params.resolveUserLabel}
          setPanelError={params.setPanelError}
          shareDraft={params.shareDraft}
        />
      ) : null}
      {params.activeTab === "security" && remoteInfo ? (
        <ExplorerContainerInfoSecuritySection
          containerNamesById={params.containerNamesById}
          remoteInfo={remoteInfo}
        />
      ) : null}
      {params.activeTab === "sync" && remoteInfo ? (
        <ExplorerContainerInfoSyncCursorsSection remoteInfo={remoteInfo} />
      ) : null}
    </MiniAppTabPanel>
  );
}

export function ExplorerContainerInfoPanel(
  params: ExplorerContainerInfoPanelProps,
) {
  const {
    activeTab,
    containerInfo,
    containerInfoError,
    handleShare,
    handleShareWithPeer,
    isLoadingContainerInfo,
    isSubmitting,
    panelError,
    setActiveTab,
    setPanelError,
    shareDraft,
  } = useExplorerContainerInfoPanelState(params);
  const tabIdPrefix = useId();

  return (
    <MiniAppFormPanel
      className="explorer-detail explorer-detail--container-info"
      key={params.containerId}
      onSubmit={handleShare}
      scroll
    >
      <ExplorerContainerInfoHeader
        containerId={params.containerId}
        containerName={params.containerName}
      />
      {isSubmitting ? (
        <ExplorerContainerInfoSharingProgress />
      ) : (
        <div className="explorer-info">
          <ExplorerContainerInfoTabs
            activeTab={activeTab}
            idPrefix={tabIdPrefix}
            setActiveTab={setActiveTab}
          />
          <ContainerInfoRemoteStatus
            containerInfo={containerInfo}
            containerInfoError={containerInfoError}
            isLoadingContainerInfo={isLoadingContainerInfo}
          />
          <ExplorerContainerInfoTabPanel
            activeTab={activeTab}
            canManageIcon={params.canManageIcon}
            containerIcon={params.containerIcon}
            containerId={params.containerId}
            containerInfo={containerInfo}
            containerInfoError={containerInfoError}
            containerNamesById={params.containerNamesById}
            canShareContainer={params.canShareContainer}
            canShareWithPeer={params.canShareWithPeer}
            idPrefix={tabIdPrefix}
            isLoadingContainerInfo={isLoadingContainerInfo}
            isSubmitting={isSubmitting}
            onOpenGrant={params.onOpenGrant}
            onShareWithPeer={handleShareWithPeer}
            peerUserId={params.peerUserId}
            primaryDocumentSettings={params.primaryDocumentSettings}
            resolveUserLabel={params.resolveUserLabel}
            setContainerIcon={params.setContainerIcon}
            setPanelError={setPanelError}
            shareDraft={shareDraft}
          />
        </div>
      )}
      {panelError ? (
        <MiniAppStatus tone="error">{panelError}</MiniAppStatus>
      ) : null}
      <ExplorerContainerInfoActions
        draftShareRecipientId={
          shareDraft.subjectType === "group"
            ? shareDraft.groupId
            : shareDraft.userId
        }
        isLoadingContainerInfo={isLoadingContainerInfo}
        isSubmitting={isSubmitting}
        showShareButton={
          !isSubmitting &&
          params.canShareContainer &&
          activeTab === "sharing" &&
          Boolean(containerInfo?.remoteInfo)
        }
      />
    </MiniAppFormPanel>
  );
}
