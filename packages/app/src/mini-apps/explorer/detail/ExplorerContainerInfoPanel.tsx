import type {
  ContainerInfo,
  ContainerShareAccessLevel,
} from "@tearleads/client-sdk";
import { useEffect, useId, useState } from "react";
import {
  MiniAppButton,
  MiniAppFormPanel,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import { EXPLORER_LABELS } from "../labels";
import type { MiniAppWindowPosition } from "../types";
import {
  ExplorerContainerInfoActions,
  ExplorerContainerInfoGroupShareSection,
  ExplorerContainerInfoHeader,
  ExplorerContainerInfoLocalSection,
  ExplorerContainerInfoPeerShareSection,
  ExplorerContainerInfoPrincipalGrantsSection,
  ExplorerContainerInfoSecuritySection,
  ExplorerContainerInfoSyncCursorsSection,
} from "./ExplorerContainerInfoSections";
import {
  useExplorerContainerInfo,
  useExplorerContainerInfoGroupShare,
  useExplorerContainerInfoPeerShare,
} from "./ExplorerContainerInfoState";

interface Props {
  containerId: string;
  containerName: string | undefined;
  containerSyncStatus: string | null;
  containerNamesById: ReadonlyMap<string, string>;
  loadContainerInfo: (containerId: string) => Promise<ContainerInfo>;
  onBackToContainer: () => void;
  onOpenGrantGroup: (groupId: string, position?: MiniAppWindowPosition) => void;
  peerUserId: string | null;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ContainerShareAccessLevel,
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}

type ContainerInfoTabId = "general" | "sharing" | "security" | "sync";

const CONTAINER_INFO_TABS: ReadonlyArray<{
  id: ContainerInfoTabId;
  label: string;
}> = [
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
    reloadToken: params.containerSyncStatus,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleShareWithGroup = useExplorerContainerInfoGroupShare({
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
    <div
      aria-label={EXPLORER_LABELS.containerInfoTabsLabel}
      className="explorer-info-tabs"
      role="tablist"
    >
      {CONTAINER_INFO_TABS.map((tab) => (
        <MiniAppButton
          aria-controls={`${params.idPrefix}-${tab.id}-panel`}
          aria-selected={params.activeTab === tab.id}
          className="explorer-info-tab"
          id={`${params.idPrefix}-${tab.id}-tab`}
          key={tab.id}
          role="tab"
          variant="ghost"
          onClick={() => {
            params.setActiveTab(tab.id);
          }}
        >
          {tab.label}
        </MiniAppButton>
      ))}
    </div>
  );
}

function ContainerInfoRemoteStatus(params: {
  containerInfo: ContainerInfo | null;
  containerInfoError: string | null;
  isLoadingContainerInfo: boolean;
  showNoRemoteInfo?: boolean | undefined;
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

  if (params.showNoRemoteInfo && !params.containerInfo?.remoteInfo) {
    return (
      <MiniAppStatus>{EXPLORER_LABELS.containerInfoNoRemoteInfo}</MiniAppStatus>
    );
  }

  return null;
}

function ExplorerContainerInfoTabPanel(params: {
  activeTab: ContainerInfoTabId;
  containerId: string;
  containerInfo: ContainerInfo | null;
  containerInfoError: string | null;
  containerNamesById: ReadonlyMap<string, string>;
  draftShareAccessLevel: ContainerShareAccessLevel;
  draftShareGroupId: string;
  idPrefix: string;
  isLoadingContainerInfo: boolean;
  isSubmitting: boolean;
  onOpenGrantGroup: (groupId: string, position?: MiniAppWindowPosition) => void;
  onShareWithPeer: () => void;
  peerUserId: string | null;
  setDraftShareAccessLevel: (value: ContainerShareAccessLevel) => void;
  setDraftShareGroupId: (value: string) => void;
  setPanelError: (error: string | null) => void;
}) {
  const remoteInfo = params.containerInfo?.remoteInfo ?? null;

  return (
    <div
      aria-labelledby={`${params.idPrefix}-${params.activeTab}-tab`}
      className="explorer-info-tab-panel"
      id={`${params.idPrefix}-${params.activeTab}-panel`}
      role="tabpanel"
    >
      {params.activeTab === "general" ? (
        <ExplorerContainerInfoLocalSection
          containerId={params.containerId}
          containerInfo={params.containerInfo}
        />
      ) : null}
      {params.activeTab !== "general" && !remoteInfo ? (
        <ContainerInfoRemoteStatus
          containerInfo={params.containerInfo}
          containerInfoError={params.containerInfoError}
          isLoadingContainerInfo={params.isLoadingContainerInfo}
          showNoRemoteInfo
        />
      ) : null}
      {params.activeTab === "sharing" && remoteInfo ? (
        <>
          <ExplorerContainerInfoPrincipalGrantsSection
            containerNamesById={params.containerNamesById}
            remoteInfo={remoteInfo}
            onOpenGrantGroup={params.onOpenGrantGroup}
          />
          <ExplorerContainerInfoGroupShareSection
            draftShareAccessLevel={params.draftShareAccessLevel}
            draftShareGroupId={params.draftShareGroupId}
            isSubmitting={params.isSubmitting}
            remoteInfo={remoteInfo}
            setDraftShareAccessLevel={params.setDraftShareAccessLevel}
            setDraftShareGroupId={params.setDraftShareGroupId}
            setPanelError={params.setPanelError}
          />
          {params.peerUserId ? (
            <ExplorerContainerInfoPeerShareSection
              isSubmitting={params.isSubmitting}
              onShareWithPeer={params.onShareWithPeer}
            />
          ) : null}
        </>
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
    </div>
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
      variant="framed"
    >
      <ExplorerContainerInfoHeader
        containerId={params.containerId}
        containerName={params.containerName}
        isSubmitting={isSubmitting}
        onBackToContainer={params.onBackToContainer}
      />
      <div className="explorer-info">
        <ExplorerContainerInfoTabs
          activeTab={activeTab}
          idPrefix={tabIdPrefix}
          setActiveTab={setActiveTab}
        />
        {activeTab === "general" ? (
          <ContainerInfoRemoteStatus
            containerInfo={containerInfo}
            containerInfoError={containerInfoError}
            isLoadingContainerInfo={isLoadingContainerInfo}
          />
        ) : null}
        <ExplorerContainerInfoTabPanel
          activeTab={activeTab}
          containerId={params.containerId}
          containerInfo={containerInfo}
          containerInfoError={containerInfoError}
          containerNamesById={params.containerNamesById}
          draftShareAccessLevel={draftShareAccessLevel}
          draftShareGroupId={draftShareGroupId}
          idPrefix={tabIdPrefix}
          isLoadingContainerInfo={isLoadingContainerInfo}
          isSubmitting={isSubmitting}
          onOpenGrantGroup={params.onOpenGrantGroup}
          onShareWithPeer={handleShareWithPeer}
          peerUserId={params.peerUserId}
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
          activeTab === "sharing" && Boolean(containerInfo?.remoteInfo)
        }
      />
    </MiniAppFormPanel>
  );
}
