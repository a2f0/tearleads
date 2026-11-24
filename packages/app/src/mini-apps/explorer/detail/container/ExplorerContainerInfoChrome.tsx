import {
  MiniAppActions,
  MiniAppButton,
  MiniAppStatePanel,
} from "../../../../components/mini-app/MiniAppLayout";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerContainerIcon } from "../../shared/ExplorerContainerIcon";
import { compactId } from "../compactId";
import { ExplorerInfoHeader } from "../ExplorerInfoHeader";

/**
 * Fills the info panel while a share runs: it seals keys for its recipient
 * and cannot be cancelled once started, so the form gives way to progress.
 */
export function ExplorerContainerInfoSharingProgress() {
  return (
    <MiniAppStatePanel
      busy
      description={EXPLORER_LABELS.containerInfoSharingProgressDescription}
      title={EXPLORER_LABELS.containerInfoSharingProgressTitle}
    />
  );
}

export function ExplorerContainerInfoHeader(params: {
  containerIcon: string | null;
  containerId: string;
  containerName: string | undefined;
}) {
  const { containerIcon, containerId, containerName } = params;
  return (
    <ExplorerInfoHeader
      icon={
        // Open, as in the container's own header: Get Info selects it.
        <ExplorerContainerIcon
          className="explorer-detail-header-icon"
          icon={containerIcon}
          isOpen
        />
      }
      subject={containerName ?? compactId(containerId)}
      title={EXPLORER_LABELS.containerInfoTitle}
    />
  );
}

export function ExplorerContainerInfoActions(params: {
  // The chosen group or user; Share stays disabled until there is one.
  draftShareRecipientId: string;
  isLoadingContainerInfo: boolean;
  isSubmitting: boolean;
  showShareButton: boolean;
}) {
  const {
    draftShareRecipientId,
    isLoadingContainerInfo,
    isSubmitting,
    showShareButton,
  } = params;
  if (!showShareButton) {
    return null;
  }

  return (
    <MiniAppActions>
      <MiniAppButton
        type="submit"
        disabled={
          isSubmitting || isLoadingContainerInfo || !draftShareRecipientId
        }
      >
        {isSubmitting
          ? EXPLORER_LABELS.containerInfoSharingAction
          : EXPLORER_LABELS.containerInfoShareAction}
      </MiniAppButton>
    </MiniAppActions>
  );
}
