import type {
  ContainerInfo,
  ContainerNode,
  ContainerShareAccessLevel,
  OrganizationDirectoryAndGroups,
} from "@tearleads/client-sdk";
import { useEffect, useId, useState } from "react";
import {
  MiniAppFormPanel,
  MiniAppStatus,
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
} from "../../../../components/mini-app/MiniAppLayout";
import { EXPLORER_LABELS } from "../../labels";
import type { MiniAppWindowPosition } from "../../types";
import {
  ExplorerContainerInfoActions,
  ExplorerContainerInfoHeader,
} from "./ExplorerContainerInfoChrome";
import { ExplorerContainerInfoLocalSection } from "./ExplorerContainerInfoLocalSection";
import { ExplorerContainerInfoSecuritySection } from "./ExplorerContainerInfoSecuritySection";
import {
  ExplorerContainerInfoGroupShareSection,
  ExplorerContainerInfoPeerShareSection,
  ExplorerContainerInfoPrincipalGrantsSection,
} from "./ExplorerContainerInfoSharingSections";
import {
  useExplorerContainerInfo,
  useExplorerContainerInfoGroupShare,
  useExplorerContainerInfoPeerShare,
} from "./ExplorerContainerInfoState";
import { ExplorerContainerInfoSyncCursorsSection } from "./ExplorerContainerInfoSyncCursorsSection";

interface Props {
  canManageIcon: boolean;
  containerIcon: string | null;
  containerId: string;
  containerName: string | undefined;
  containerSyncStatus: string | null;
  containerNamesById: ReadonlyMap<string, string>;
  canShareContainer: boolean;
  canShareWithPeer: boolean;
  loadContainerInfo: (containerId: string) => Promise<ContainerInfo>;
  onOpenGrant: (
    grant: {
      containerId: string;
      subjectId: string;
      subjectType: "group" | "user";
    },
    position?: MiniAppWindowPosition,
  ) => void;
  readModelProjection?: OrganizationDirectoryAndGroups | null | undefined;
  readModelRevision?: number | undefined;
  readModelScope?: object | null | undefined;
  peerUserId: string | null;
  setContainerIcon: (
    containerId: string,
    icon: string | null,
  ) => Promise<ContainerNode | null>;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ContainerShareAccessLevel,
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}

type ContainerInfoTabId = "general" | "sharing" | "security" | "sync";

const CONTAINER_INFO_TABS: ReadonlyArray<
  MiniAppTabDescriptor<ContainerInfoTabId>
> = [
  { id: "general", label: EXPLORER_LABELS.containerInfoGeneralTab },
  { id: "sharing", label: EXPLORER_LABELS.containerInfoSharingTab },
  { id: "security", label: EXPLORER_LABELS.containerInfoSecurityTab },
  { id: "sync", label: EXPLORER_LABELS.containerInfoSyncTab },
];

function useExplorerContainerInfoPanelState(params: Props) {
  const { containerId } = params;
  const [activeTab, setActiveTab] = useState<ContainerInfoTabId>("general");
  const containerInfoState = useExplorerContainerInfo({
    containerId,
    loadContainerInfo: params.loadContainerInfo,
    organizationReadModelProjection: params.readModelProjection,
    organizationReadModelRevision: params.readModelRevision,
    organizationReadModelScope: params.readModelScope,
    reloadToken: params.containerSyncStatus,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleShareWithGroup = useExplorerContainerInfoGroupShare({
    canShareContainer: params.canShareContainer,
    containerId,
    draftShareAccessLevel: containerInfoState.draftShareAccessLevel,
    draftShareGroupId: containerInfoState.draftShareGroupId,
    isSubmitting,
    reloadContainerInfo: containerInfoState.reloadContainerInfo,
    setIsSubmitting,
    setPanelError: containerInfoState.setPanelError,
    shareWithGroup: params.shareWithGroup,
  });
  const handleShareWithPeer = useExplorerContainerInfoPeerShare({
    canShareContainer: params.canShareContainer,
    containerId,
    isSubmitting,
    peerUserId: params.peerUserId,
    reloadContainerInfo: containerInfoState.reloadContainerInfo,
    setIsSubmitting,
    setPanelError: containerInfoState.setPanelError,
    shareWithUser: params.shareWithUser,
  });

  useEffect(() => {
    setActiveTab("general");
  }, [containerId]);

  return {
    ...containerInfoState,
    activeTab,
    handleShareWithGroup,
    handleShareWithPeer,
    isSubmitting,
    setActiveTab,
  };
}

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
  draftShareAccessLevel: ContainerShareAccessLevel;
  draftShareGroupId: string;
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
  setDraftShareAccessLevel: (value: ContainerShareAccessLevel) => void;
  setDraftShareGroupId: (value: string) => void;
  setPanelError: (error: string | null) => void;
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
      />
      {params.canShareContainer ? (
        <ExplorerContainerInfoGroupShareSection
          draftShareAccessLevel={params.draftShareAccessLevel}
          draftShareGroupId={params.draftShareGroupId}
          isSubmitting={params.isSubmitting}
          remoteInfo={params.remoteInfo}
          setDraftShareAccessLevel={params.setDraftShareAccessLevel}
          setDraftShareGroupId={params.setDraftShareGroupId}
          setPanelError={params.setPanelError}
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
  draftShareAccessLevel: ContainerShareAccessLevel;
  draftShareGroupId: string;
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
  setContainerIcon: (
    containerId: string,
    icon: string | null,
  ) => Promise<ContainerNode | null>;
  setDraftShareAccessLevel: (value: ContainerShareAccessLevel) => void;
  setDraftShareGroupId: (value: string) => void;
  setPanelError: (error: string | null) => void;
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
      {params.activeTab !== "general" && !remoteInfo ? (
        params.isLoadingContainerInfo || params.containerInfoError ? null : (
          <MiniAppStatus>
            {EXPLORER_LABELS.containerInfoNoRemoteInfo}
          </MiniAppStatus>
        )
      ) : null}
      {params.activeTab === "sharing" && remoteInfo ? (
        <ExplorerContainerInfoSharingSections
          containerNamesById={params.containerNamesById}
          canShareContainer={params.canShareContainer}
          canShareWithPeer={params.canShareWithPeer}
          draftShareAccessLevel={params.draftShareAccessLevel}
          draftShareGroupId={params.draftShareGroupId}
          isSubmitting={params.isSubmitting}
          remoteInfo={remoteInfo}
          onOpenGrant={params.onOpenGrant}
          onShareWithPeer={params.onShareWithPeer}
          peerUserId={params.peerUserId}
          setDraftShareAccessLevel={params.setDraftShareAccessLevel}
          setDraftShareGroupId={params.setDraftShareGroupId}
          setPanelError={params.setPanelError}
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

export function ExplorerContainerInfoPanel(params: Props) {
  const {
    activeTab,
    containerInfo,
    containerInfoError,
    draftShareAccessLevel,
    draftShareGroupId,
    handleShareWithGroup,
    handleShareWithPeer,
    isLoadingContainerInfo,
    isSubmitting,
    panelError,
    setDraftShareAccessLevel,
    setDraftShareGroupId,
    setPanelError,
    setActiveTab,
  } = useExplorerContainerInfoPanelState(params);
  const tabIdPrefix = useId();

  return (
    <MiniAppFormPanel
      className="explorer-detail explorer-detail--container-info"
      key={params.containerId}
      onSubmit={handleShareWithGroup}
      scroll
    >
      <ExplorerContainerInfoHeader
        containerId={params.containerId}
        containerName={params.containerName}
      />
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
          draftShareAccessLevel={draftShareAccessLevel}
          draftShareGroupId={draftShareGroupId}
          idPrefix={tabIdPrefix}
          isLoadingContainerInfo={isLoadingContainerInfo}
          isSubmitting={isSubmitting}
          onOpenGrant={params.onOpenGrant}
          onShareWithPeer={handleShareWithPeer}
          peerUserId={params.peerUserId}
          setContainerIcon={params.setContainerIcon}
          setDraftShareAccessLevel={setDraftShareAccessLevel}
          setDraftShareGroupId={setDraftShareGroupId}
          setPanelError={setPanelError}
        />
      </div>
      {panelError ? (
        <MiniAppStatus tone="error">{panelError}</MiniAppStatus>
      ) : null}
      <ExplorerContainerInfoActions
        draftShareGroupId={draftShareGroupId}
        isLoadingContainerInfo={isLoadingContainerInfo}
        isSubmitting={isSubmitting}
        showShareButton={
          params.canShareContainer &&
          activeTab === "sharing" &&
          Boolean(containerInfo?.remoteInfo)
        }
      />
    </MiniAppFormPanel>
  );
}
