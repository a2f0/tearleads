import { type MouseEvent, useCallback, useState } from "react";
import { useMiniAppBusActions } from "../../../../mini-apps/bus";
import { Menu, type MenuPosition } from "../../../shared/Menu";
import { SyncGlyph } from "../../../shared/SyncGlyph";
import type { SyncStatus } from "./syncStatusModel";
import { useSyncStatus } from "./useSyncStatus";
import "./SyncStatusIndicator.css";

// Jumps to the Explorer's Write Queue view — the panel this indicator shares its
// source of truth with (`pathSegments: ["writes"]`, see the routes module).
const OPEN_WRITE_QUEUE_LABEL = "View write queue";

// Jumps to the Org Manager's Billing view — where the "Update billing to
// resume" instruction in the billing-paused status text can actually be done.
// That view bills the *active* org; when the block is another organization's,
// the same destination is still the right one — its org switcher is how the
// lapsed org is reached.
const OPEN_BILLING_LABEL = "Update billing";

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
      className="sync-status-indicator"
      onClick={onToggle}
      onMouseDown={expanded ? stopTriggerMouseDown : undefined}
      title={title}
      type="button"
    >
      <SyncGlyph tone={status} />
    </button>
  );
}

// The popover body: the status detail, plus a link into the Org Manager's
// Billing view when billing has sync paused and a link into the Explorer Write
// Queue when the local queue holds unflushed data. Props-only for the same
// reason.
export function SyncStatusPopover({
  title,
  billingBlocked,
  hasUnflushed,
  onOpenBilling,
  onOpenWriteQueue,
}: {
  title: string;
  billingBlocked: boolean;
  hasUnflushed: boolean;
  onOpenBilling: () => void;
  onOpenWriteQueue: () => void;
}) {
  return (
    <>
      <p className="sync-status-popover-message">{title}</p>
      {billingBlocked && (
        <button
          className="sync-status-popover-action"
          onClick={onOpenBilling}
          type="button"
        >
          <span className="menu-item-label">{OPEN_BILLING_LABEL}</span>
        </button>
      )}
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
// red warning = writes failing terminally, amber warning = billing paused).
// Clicking it opens a popover with the status detail plus a link into the Org
// Manager's Billing view when billing has sync paused and, when the write queue
// is non-empty, a link into the Explorer's Write Queue view. Same source of
// truth as that panel (see `useSyncStatus`).
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
  const openBilling = useCallback(() => {
    openMiniApp({ appId: "org-manager", pathSegments: ["billing"] });
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
            billingBlocked={status === "billing"}
            hasUnflushed={pendingWriteCount > 0}
            onOpenBilling={openBilling}
            onOpenWriteQueue={openWriteQueue}
            title={title}
          />
        </Menu>
      )}
    </>
  );
}
