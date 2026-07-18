import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalPanel,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { EXPLORER_LABELS, getExplorerPurgeProgressStatus } from "../labels";
import "./ExplorerPurgeProgressModal.css";
import type { ExplorerPurgeRunState } from "./useExplorerPurgeRun";

function getExplorerPurgeStatusText(run: ExplorerPurgeRunState): string {
  switch (run.status) {
    case "running":
      return run.progress
        ? getExplorerPurgeProgressStatus(run.progress)
        : EXPLORER_LABELS.purgeProgressPreparingStatus;
    case "done":
      return EXPLORER_LABELS.purgeProgressDoneStatus;
    case "cancelled":
      return EXPLORER_LABELS.purgeProgressCancelledStatus;
    case "failed":
      return run.error ?? EXPLORER_LABELS.purgeProgressPartialFailure;
  }
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
  const { onCancel, onClose, run } = params;
  if (!run) {
    return null;
  }

  const isRunning = run.status === "running";
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
        aria-labelledby="explorer-purge-progress-title"
        aria-modal="true"
        role="dialog"
      >
        <h2 id="explorer-purge-progress-title">{run.title}</h2>
        <span
          aria-label={run.title}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={percent}
          className="explorer-purge-progress"
          role="progressbar"
        >
          <span style={{ width: `${percent}%` }} />
        </span>
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
