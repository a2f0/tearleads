import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppStatePanel,
} from "../../../../components/mini-app/MiniAppLayout";
import { EXPLORER_LABELS } from "../../labels";
import { compactId } from "../compactId";

// Kept beside the panel: labelCatalog.ts is at its source-shape budget.
const SHARING_PROGRESS = {
  description:
    "Sealing this folder's keys for the recipient and recording the grant.",
  title: "Sharing folder...",
} as const;

/**
 * Fills the info panel while a share runs: it seals keys for its recipient
 * and cannot be cancelled once started, so the form gives way to progress.
 */
export function ExplorerContainerInfoSharingProgress() {
  return (
    <MiniAppStatePanel
      busy
      description={SHARING_PROGRESS.description}
      title={SHARING_PROGRESS.title}
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
  draftShareGroupId: string;
  isLoadingContainerInfo: boolean;
  isSubmitting: boolean;
  showShareButton: boolean;
}) {
  const {
    draftShareGroupId,
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
        disabled={isSubmitting || isLoadingContainerInfo || !draftShareGroupId}
      >
        {isSubmitting
          ? EXPLORER_LABELS.containerInfoSharingAction
          : EXPLORER_LABELS.containerInfoShareAction}
      </MiniAppButton>
    </MiniAppActions>
  );
}
