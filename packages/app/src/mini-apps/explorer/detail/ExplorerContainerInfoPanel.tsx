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

export function ExplorerContainerInfoPanel(params: Props) {
  const {
    containerId,
    containerName,
    containerNamesById,
    loadContainerInfo,
    onBackToContainer,
    onOpenGrantGroup,
    peerUserId,
    shareWithGroup,
    shareWithUser,
  } = params;
  const {
    containerInfo,
    containerInfoError,
    draftShareAccessLevel,
    draftShareGroupId,
    isLoadingContainerInfo,
    panelError,
    reloadContainerInfo,
    setDraftShareAccessLevel,
    setDraftShareGroupId,
    setPanelError,
  } = useExplorerContainerInfo({ containerId, loadContainerInfo });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleShareWithGroup = useExplorerContainerInfoGroupShare({
    containerId,
    draftShareAccessLevel,
    draftShareGroupId,
    isSubmitting,
    reloadContainerInfo,
    setIsSubmitting,
    setPanelError,
    shareWithGroup,
  });
  const handleShareWithPeer = useExplorerContainerInfoPeerShare({
    containerId,
    isSubmitting,
    peerUserId,
    reloadContainerInfo,
    setIsSubmitting,
    setPanelError,
    shareWithUser,
  });

  return (
    <MiniAppFormPanel
      className="explorer-detail explorer-detail--container-info"
      key={containerId}
      onSubmit={handleShareWithGroup}
      scroll
      variant="framed"
    >
      <ExplorerContainerInfoHeader
        containerId={containerId}
        containerName={containerName}
        isSubmitting={isSubmitting}
        onBackToContainer={onBackToContainer}
      />
      <ExplorerContainerInfoBody
        containerNamesById={containerNamesById}
        containerId={containerId}
        containerInfo={containerInfo}
        containerInfoError={containerInfoError}
        draftShareAccessLevel={draftShareAccessLevel}
        draftShareGroupId={draftShareGroupId}
        isLoadingContainerInfo={isLoadingContainerInfo}
        isSubmitting={isSubmitting}
        onShareWithPeer={handleShareWithPeer}
        onOpenGrantGroup={onOpenGrantGroup}
        peerUserId={peerUserId}
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
