import type {
  ContainerInfo,
  ContainerShareAccessLevel,
} from "@tearleads/client-sdk";
import { useState } from "react";
import {
  MiniAppFormPanel,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import type { MiniAppWindowPosition } from "../types";
import {
  ExplorerContainerInfoActions,
  ExplorerContainerInfoBody,
  ExplorerContainerInfoHeader,
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

function useExplorerContainerInfoPanelState(params: Props) {
  const { containerId } = params;
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

  return {
    ...containerInfoState,
    handleShareWithGroup,
    handleShareWithPeer,
    isSubmitting,
  };
}

export function ExplorerContainerInfoPanel(params: Props) {
  const {
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
  } = useExplorerContainerInfoPanelState(params);

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
      <ExplorerContainerInfoBody
        containerNamesById={params.containerNamesById}
        containerId={params.containerId}
        containerInfo={containerInfo}
        containerInfoError={containerInfoError}
        draftShareAccessLevel={draftShareAccessLevel}
        draftShareGroupId={draftShareGroupId}
        isLoadingContainerInfo={isLoadingContainerInfo}
        isSubmitting={isSubmitting}
        onShareWithPeer={handleShareWithPeer}
        onOpenGrantGroup={params.onOpenGrantGroup}
        peerUserId={params.peerUserId}
        setDraftShareAccessLevel={setDraftShareAccessLevel}
        setDraftShareGroupId={setDraftShareGroupId}
        setPanelError={setPanelError}
      />
      {panelError ? (
        <MiniAppStatus tone="error">{panelError}</MiniAppStatus>
      ) : null}
      <ExplorerContainerInfoActions
        draftShareGroupId={draftShareGroupId}
        isLoadingContainerInfo={isLoadingContainerInfo}
        isSubmitting={isSubmitting}
        showShareButton={Boolean(containerInfo?.remoteInfo)}
      />
    </MiniAppFormPanel>
  );
}
