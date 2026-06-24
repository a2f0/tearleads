import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
} from "../../../components/shared/MiniAppLayout";
import { EXPLORER_LABELS } from "../labels";
import { compactId } from "./compactId";

export function ExplorerContainerInfoHeader(params: {
  containerId: string;
  containerName: string | undefined;
  isSubmitting: boolean;
  onBackToContainer: () => void;
}) {
  const { containerId, containerName, isSubmitting, onBackToContainer } =
    params;
  return (
    <MiniAppHeader>
      <MiniAppHeaderCopy>
        <strong>{EXPLORER_LABELS.containerInfoTitle}</strong>
        <span>{containerName ?? compactId(containerId)}</span>
      </MiniAppHeaderCopy>
      <MiniAppActions>
        <MiniAppButton disabled={isSubmitting} onClick={onBackToContainer}>
          {EXPLORER_LABELS.backToContainerAction}
        </MiniAppButton>
      </MiniAppActions>
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
