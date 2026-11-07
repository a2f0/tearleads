import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppStatePanel,
} from "../../../../components/mini-app/MiniAppLayout";
import { EXPLORER_LABELS } from "../../labels";
import { compactId } from "../compactId";

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
  containerId: string;
  containerName: string | undefined;
}) {
  const { containerId, containerName } = params;
  return (
    <MiniAppHeader>
      <MiniAppHeaderCopy>
        <strong>{EXPLORER_LABELS.containerInfoTitle}</strong>
        <span>{containerName ?? compactId(containerId)}</span>
      </MiniAppHeaderCopy>
    </MiniAppHeader>
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
