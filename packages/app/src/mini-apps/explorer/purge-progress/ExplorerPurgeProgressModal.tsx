import { useCallback, useId } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalPanel,
  MiniAppProgressBar,
  MiniAppStatus,
  useModalEscapeAndFocusRestore,
} from "../../../components/mini-app/MiniAppLayout";
import { EXPLORER_LABELS, getExplorerPurgeProgressStatus } from "../labels";
import type { ExplorerPurgeRunState } from "./useExplorerPurgeRun";

function getExplorerPurgeStatusText(run: ExplorerPurgeRunState): string {
  switch (run.status) {
    case "running":
      if (run.progress) return getExplorerPurgeProgressStatus(run.progress);
      return run.moveSettlement === "waiting"
        ? EXPLORER_LABELS.purgeProgressFinishingMoveStatus
        : EXPLORER_LABELS.purgeProgressPreparingStatus;
    case "done":
      return EXPLORER_LABELS.purgeProgressDoneStatus;
    case "cancelled":
      // The purge reports progress before its first destructive step, and a
      // remote delete can land even when its item later fails or throws, so
      // only a run stopped before any progress deleted nothing.
      return run.progress
        ? EXPLORER_LABELS.purgeProgressCancelledStatus
        : EXPLORER_LABELS.purgeProgressCancelledUntouchedStatus;
    case "failed":
      return run.error ?? EXPLORER_LABELS.purgeProgressPartialFailure;
  }
}

function ExplorerPurgeProgressDialog(params: {
  onCancel: () => void;
  onClose: () => void;
  run: ExplorerPurgeRunState;
}) {
  const { onCancel, onClose, run } = params;
  const titleId = useId();
  const isRunning = run.status === "running";
  const handleEscape = useCallback(() => {
    if (!isRunning) {
      onClose();
    }
  }, [isRunning, onClose]);
  useModalEscapeAndFocusRestore(handleEscape);

  const total = run.progress?.totalCount ?? 0;
  const finished = run.progress
    ? run.progress.completedCount + run.progress.failedCount
    : 0;
  const percent =
    run.status === "done"
      ? 100
      : total > 0
        ? Math.min(100, Math.round((finished / total) * 100))
        : 0;

  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        aria-labelledby={titleId}
        aria-modal="true"
        role="dialog"
      >
        <h2 id={titleId}>{run.title}</h2>
        <MiniAppProgressBar
          className="explorer-purge-progress"
          label={run.title}
          percent={percent}
          tone={run.status === "failed" ? "error" : "default"}
        />
        <MiniAppStatus tone={run.status === "failed" ? "error" : "muted"}>
          {getExplorerPurgeStatusText(run)}
        </MiniAppStatus>
        <MiniAppActions>
          {isRunning ? (
            <MiniAppButton onClick={onCancel} type="button">
              {EXPLORER_LABELS.purgeProgressStopAction}
            </MiniAppButton>
          ) : (
            <MiniAppButton onClick={onClose} type="button">
              {EXPLORER_LABELS.purgeProgressCloseAction}
            </MiniAppButton>
          )}
        </MiniAppActions>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}

// The macOS-style progress overlay for a long-running "Delete Forever" / "Empty
// Trash". While running it shows a determinate bar plus a "Stop" that cancels at
// the next item boundary; once settled it swaps to a single "Close". The panel is
// not a form and has no backdrop-dismiss, so a purge can only be interrupted by
// Stop, never accidentally by clicking away.
export function ExplorerPurgeProgressModal(params: {
  onCancel: () => void;
  onClose: () => void;
  run: ExplorerPurgeRunState | null;
}) {
  if (!params.run) {
    return null;
  }

  return (
    <ExplorerPurgeProgressDialog
      onCancel={params.onCancel}
      onClose={params.onClose}
      run={params.run}
    />
  );
}
