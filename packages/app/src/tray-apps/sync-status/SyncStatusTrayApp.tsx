import { requestAllDomainSyncLanes } from "@tearleads/client-sdk";
import { Menu, type MenuPosition } from "@tearleads/windowing";
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import { SyncGlyph } from "../../components/shared/SyncGlyph";
import { useAppNavigationActions } from "../../navigation/AppNavigationProvider";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import {
  SyncStatusPopover,
  type SyncStatusPopoverAction,
} from "./SyncStatusPopover";
import type { SyncStatus } from "./syncStatusModel";
import {
  describeSyncStatusDetails,
  listSyncStatusActions,
  type SyncStatusActionId,
} from "./syncStatusPopoverModel";
import { usePopoverTransfers } from "./usePopoverTransfers";
import { type SyncStatusResult, useSyncStatus } from "./useSyncStatus";
import "./SyncStatusTrayApp.css";

const SYNC_STATUS_ACTION_LABELS: Record<SyncStatusActionId, string> = {
  "sync-now": "Sync now",
  // Jumps to the Org Manager's Billing view — where the "Update billing to
  // resume" instruction in the billing-paused status text can actually be
  // done. That view bills the *active* org; when the block is another
  // organization's, its org switcher is how the lapsed org is reached.
  billing: "Update billing",
  "write-queue": "View write queue",
  downloads: "View downloads",
  uploads: "View uploads",
  "sync-lanes": "View sync lanes",
};

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

// The trigger and its popover, without the SDK: the popover's open state.
// `renderPopover` draws the body only while it is open, so what it reads
// (the download queue) is read only then. A right-click or long press, which
// opens the tray's context menu, closes the popover first so only one menu
// shows.
export function SyncStatusTrayControl({
  renderPopover,
  status,
  title,
}: {
  renderPopover: (close: () => void) => ReactNode;
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
          {renderPopover(closeMenu)}
        </Menu>
      )}
    </>
  );
}

// Where each popover action leads: a request for every sync lane, or a view
// opened through app navigation by id, since a tray app imports no mini-app.
const ACTION_DESTINATIONS = {
  billing: { appId: "org-manager", pathSegments: ["billing"] },
  downloads: { appId: "explorer", pathSegments: ["downloads"] },
  "sync-lanes": { appId: "explorer", pathSegments: ["sync", "lanes"] },
  uploads: { appId: "explorer", pathSegments: ["uploads"] },
  "write-queue": { appId: "explorer", pathSegments: ["writes"] },
} as const;

// The open popover: reads what only it shows (the download queue and the
// Explorer's file uploads), then lists the status, the per-direction details,
// and the actions that apply.
function SyncStatusPopoverContent({
  close,
  sync,
}: {
  close: () => void;
  sync: SyncStatusResult;
}) {
  const runtime = useTearleadsRuntime();
  const { openMiniApp } = useAppNavigationActions();
  const { downloads, uploadingFileCount } = usePopoverTransfers();
  const domainScope = runtime.state.domainScope;
  const canSync = runtime.state.online && runtime.auth.isAuthenticated;
  const actions = useMemo(
    () =>
      listSyncStatusActions({
        billingBlocked: sync.status === "billing",
        canSync,
        downloads,
        lanes: sync.lanes,
        pendingWriteCount: sync.pendingWriteCount,
        queueReadFailed: sync.queueReadFailed,
        uploadingFileCount,
      }).map(
        (id): SyncStatusPopoverAction => ({
          id,
          label: SYNC_STATUS_ACTION_LABELS[id],
          onSelect: () => {
            if (id === "sync-now") requestAllDomainSyncLanes(domainScope);
            else openMiniApp(ACTION_DESTINATIONS[id]);
            close();
          },
        }),
      ),
    [
      canSync,
      close,
      domainScope,
      downloads,
      openMiniApp,
      sync,
      uploadingFileCount,
    ],
  );
  const details = describeSyncStatusDetails({
    downloads,
    lanes: sync.lanes,
    pendingWriteCount: sync.pendingWriteCount,
    uploadingFileCount,
  });
  return (
    <SyncStatusPopover actions={actions} details={details} title={sync.title} />
  );
}

// The Sync Status tray app. The glyph: green = synced, green ring = syncing
// with nothing local waiting, red = unflushed data, red warning = writes or
// sync tasks failing or the queue unreadable, amber warning = billing paused.
// Clicking it opens a popover with the status, what is waiting in each
// direction, Sync now, and links into the views that explain it.
export function SyncStatusTrayApp() {
  const sync = useSyncStatus();
  const renderPopover = useCallback(
    (close: () => void) => (
      <SyncStatusPopoverContent close={close} sync={sync} />
    ),
    [sync],
  );
  return (
    <SyncStatusTrayControl
      renderPopover={renderPopover}
      status={sync.status}
      title={sync.title}
    />
  );
}
