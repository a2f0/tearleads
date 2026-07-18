import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import type { SyncStatus } from "./syncStatusModel";
import { useSyncStatus } from "./useSyncStatus";
import "./SyncStatusIndicator.css";

// Presentational half — a props-only view so the four states can be rendered and
// asserted without standing up the SDK/billing providers (see the `.test`).
export function SyncStatusIndicatorView({
  status,
  title,
}: {
  status: SyncStatus;
  title: string;
}) {
  return (
    <span
      aria-label={title}
      className={`sync-status-indicator sync-status-indicator--${status}`}
      role="img"
      title={title}
    >
      {status === "billing" ? (
        <WarningIcon aria-hidden focusable={false} size={18} weight="fill" />
      ) : (
        <span aria-hidden className="sync-status-indicator-dot" />
      )}
    </span>
  );
}

// A persistent footer-tray indicator: a green dot when the local write queue is
// empty, a red dot when it holds unflushed data, and a warning glyph when the
// org's billing has lapsed and sync is paused. Same source of truth as the
// Explorer Write Queue panel (see `useSyncStatus`).
export function SyncStatusIndicator() {
  const { status, title } = useSyncStatus();
  return <SyncStatusIndicatorView status={status} title={title} />;
}
