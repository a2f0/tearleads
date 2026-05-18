import { useState } from "react";
import type {
  ExplorerContainerInfo,
  ExplorerContainerShareAccessLevel,
} from "../../../stores/explorer/containerInfo";
import type { MiniAppWindowPosition } from "../../bus";
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

export function ExplorerContainerInfoPanel(params: {
  containerId: string;
  containerName: string | undefined;
  loadContainerInfo: (containerId: string) => Promise<ExplorerContainerInfo>;
  onBackToContainer: () => void;
  onOpenGrantGroup: (groupId: string, position?: MiniAppWindowPosition) => void;
  peerUserId: string | null;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ExplorerContainerShareAccessLevel,
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}) {
  const {
    containerId,
    containerName,
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

  const showShareButton = Boolean(containerInfo?.remoteInfo);

  return (
    <form
      className="explorer-detail explorer-detail--container-info"
      key={containerId}
      onSubmit={handleShareWithGroup}
    >
      <ExplorerContainerInfoHeader
        containerId={containerId}
        containerName={containerName}
        isSubmitting={isSubmitting}
        onBackToContainer={onBackToContainer}
      />
      <ExplorerContainerInfoBody
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
        <div className="explorer-modal-error">{panelError}</div>
      ) : null}
      <ExplorerContainerInfoActions
        draftShareGroupId={draftShareGroupId}
        isLoadingContainerInfo={isLoadingContainerInfo}
        isSubmitting={isSubmitting}
        showShareButton={showShareButton}
      />
    </form>
  );
}
