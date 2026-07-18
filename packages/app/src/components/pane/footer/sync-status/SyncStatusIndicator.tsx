import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { type MouseEvent, useCallback, useState } from "react";
import { useMiniAppBusActions } from "../../../../mini-apps/bus";
import { Menu, type MenuPosition } from "../../../shared/Menu";
import type { SyncStatus } from "./syncStatusModel";
import { useSyncStatus } from "./useSyncStatus";
import "./SyncStatusIndicator.css";

// Jumps to the Explorer's Write Queue view — the panel this indicator shares its
// source of truth with (`pathSegments: ["writes"]`, see the routes module).
const OPEN_WRITE_QUEUE_LABEL = "View write queue";

// Applied only while this popover is open: keep the trigger's own mousedown from
// reaching Menu's document-level outside-click handler, so clicking the button
// closes the popover via onClick instead of closing-then-reopening. While it is
// closed the mousedown must propagate normally, so clicking the indicator still
// dismisses any other open menu (the footer menu, the other pane's popover).
function stopTriggerMouseDown(event: MouseEvent<HTMLButtonElement>) {
  event.stopPropagation();
}

// The clickable trigger — a props-only button so its states render and assert
// without the SDK/billing providers or the popover (see the `.test`).
export function SyncStatusIndicatorView({
  status,
  title,
  expanded,
  onToggle,
}: {
  status: SyncStatus;
  title: string;
  expanded: boolean;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-expanded={expanded}
      aria-haspopup="menu"
      aria-label={title}
      className={`sync-status-indicator sync-status-indicator--${status}`}
      onClick={onToggle}
      onMouseDown={expanded ? stopTriggerMouseDown : undefined}
      title={title}
      type="button"
    >
      {status === "billing" ? (
        <WarningIcon aria-hidden focusable={false} size={18} weight="fill" />
      ) : (
        <span aria-hidden className="sync-status-indicator-dot" />
      )}
    </button>
  );
}

// The popover body: the status detail, plus a link into the Explorer Write Queue
// when the local queue holds unflushed data. Props-only for the same reason.
export function SyncStatusPopover({
  title,
  hasUnflushed,
  onOpenWriteQueue,
}: {
  title: string;
  hasUnflushed: boolean;
  onOpenWriteQueue: () => void;
}) {
  return (
    <>
      <p className="sync-status-popover-message">{title}</p>
      {hasUnflushed && (
        <button
          className="sync-status-popover-action"
          onClick={onOpenWriteQueue}
          type="button"
        >
          <span className="menu-item-label">{OPEN_WRITE_QUEUE_LABEL}</span>
        </button>
      )}
    </>
  );
}

// A persistent footer-tray indicator (green = synced, red = unflushed data,
// warning = billing paused). Clicking it opens a popover with the status detail
// and, when the write queue is non-empty, a link into the Explorer's Write Queue
// view. Same source of truth as that panel (see `useSyncStatus`).
export function SyncStatusIndicator() {
  const { status, title, pendingWriteCount } = useSyncStatus();
  const { openMiniApp } = useMiniAppBusActions();
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const toggleMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    // Anchor to the button rect (not the cursor) so keyboard activation, which
    // carries no pointer coordinates, still places the popover over the button.
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition((current) =>
      current ? null : { x: rect.left, y: rect.top },
    );
  }, []);
  const closeMenu = useCallback(() => setMenuPosition(null), []);
  const openWriteQueue = useCallback(() => {
    openMiniApp({ appId: "explorer", pathSegments: ["writes"] });
    setMenuPosition(null);
  }, [openMiniApp]);

  return (
    <>
      <SyncStatusIndicatorView
        expanded={menuPosition !== null}
        onToggle={toggleMenu}
        status={status}
        title={title}
      />
      {menuPosition && (
        <Menu onClose={closeMenu} position={menuPosition}>
          <SyncStatusPopover
            hasUnflushed={pendingWriteCount > 0}
            onOpenWriteQueue={openWriteQueue}
            title={title}
          />
        </Menu>
      )}
    </>
  );
}
