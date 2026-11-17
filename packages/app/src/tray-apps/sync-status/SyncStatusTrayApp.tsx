import { Menu, type MenuPosition } from "@tearleads/windowing";
import { type MouseEvent, useCallback, useState } from "react";
import { SyncGlyph } from "../../components/shared/SyncGlyph";
import { useAppNavigationActions } from "../../navigation/AppNavigationProvider";
import type { SyncStatus } from "./syncStatusModel";
import { useSyncStatus } from "./useSyncStatus";
import "./SyncStatusTrayApp.css";

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
  onContextMenu,
  onToggle,
}: {
  status: SyncStatus;
  title: string;
  expanded: boolean;
  onContextMenu?: (() => void) | undefined;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-expanded={expanded}
      aria-haspopup="menu"
      aria-label={title}
      className="sync-status-indicator"
      onClick={onToggle}
      onContextMenu={onContextMenu}
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
// Queue when the local queue holds unflushed data or could not be read (that
// panel shows why). Props-only for the same reason.
export function SyncStatusPopover({
  title,
  billingBlocked,
  showWriteQueueLink,
  onOpenBilling,
  onOpenWriteQueue,
}: {
  title: string;
  billingBlocked: boolean;
  showWriteQueueLink: boolean;
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
      {showWriteQueueLink && (
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

// The trigger and its popover, without the SDK: the popover's open state and
// its links. A right-click or long press, which opens the tray's context menu,
// closes the popover first so only one menu shows.
export function SyncStatusTrayControl({
  billingBlocked,
  onOpenBilling,
  onOpenWriteQueue,
  showWriteQueueLink,
  status,
  title,
}: {
  billingBlocked: boolean;
  onOpenBilling: () => void;
  onOpenWriteQueue: () => void;
  showWriteQueueLink: boolean;
  status: SyncStatus;
  title: string;
}) {
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

  return (
    <>
      <SyncStatusIndicatorView
        expanded={menuPosition !== null}
        onContextMenu={closeMenu}
        onToggle={toggleMenu}
        status={status}
        title={title}
      />
      {menuPosition && (
        <Menu onClose={closeMenu} position={menuPosition}>
          <SyncStatusPopover
            billingBlocked={billingBlocked}
            showWriteQueueLink={showWriteQueueLink}
            onOpenBilling={() => {
              onOpenBilling();
              closeMenu();
            }}
            onOpenWriteQueue={() => {
              onOpenWriteQueue();
              closeMenu();
            }}
            title={title}
          />
        </Menu>
      )}
    </>
  );
}

// The Sync Status tray app (green = synced, red = unflushed data, red
// warning = writes failing terminally or the queue unreadable, amber
// warning = billing paused).
// Clicking it opens a popover with the status detail plus a link into the Org
// Manager's Billing view when billing has sync paused and, when the write queue
// is non-empty, a link into the Explorer's Write Queue view. Same source of
// truth as that panel (see `useSyncStatus`). It opens those views through app
// navigation by id, since a tray app imports no mini-app.
export function SyncStatusTrayApp() {
  const { status, title, pendingWriteCount, queueReadFailed } = useSyncStatus();
  const { openMiniApp } = useAppNavigationActions();
  const openWriteQueue = useCallback(
    () => openMiniApp({ appId: "explorer", pathSegments: ["writes"] }),
    [openMiniApp],
  );
  const openBilling = useCallback(
    () => openMiniApp({ appId: "org-manager", pathSegments: ["billing"] }),
    [openMiniApp],
  );

  return (
    <SyncStatusTrayControl
      billingBlocked={status === "billing"}
      onOpenBilling={openBilling}
      onOpenWriteQueue={openWriteQueue}
      showWriteQueueLink={pendingWriteCount > 0 || queueReadFailed}
      status={status}
      title={title}
    />
  );
}
