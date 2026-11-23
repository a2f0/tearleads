import { requestAllDomainSyncLanes } from "@tearleads/client-sdk";
import { Menu, type MenuPosition } from "@tearleads/windowing";
import { type MouseEvent, type ReactNode, useCallback, useState } from "react";
import { SyncGlyph } from "../../components/shared/SyncGlyph";
import { useAppNavigationActions } from "../../navigation/AppNavigationProvider";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDomainDocumentQueries } from "../../providers/sdk/useDomainDocumentQueries";
import { SyncStatusPopoverBody } from "./SyncStatusPopoverBody";
import type { SyncStatus } from "./syncStatusModel";
import { usePopoverTransfers } from "./usePopoverTransfers";
import { type SyncStatusResult, useSyncStatus } from "./useSyncStatus";
import "./SyncStatusTrayApp.css";

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

// The open popover: reads what only it shows (the download queue and the
// Explorer's file uploads) and hands the body its actions' effects.
function SyncStatusPopoverContent({
  close,
  sync,
}: {
  close: () => void;
  sync: SyncStatusResult;
}) {
  const runtime = useTearleadsRuntime();
  const { openMiniApp } = useAppNavigationActions();
  const domainScope = runtime.state.domainScope;
  const dbReady = runtime.infra.dbStatus === "ready";
  const documentQueries = useDomainDocumentQueries(runtime);
  const { downloads, uploadingFileCount } = usePopoverTransfers({
    dbReady,
    documentQueries,
    domainScope,
  });
  const syncNow = useCallback(
    () => requestAllDomainSyncLanes(domainScope),
    [domainScope],
  );
  return (
    <SyncStatusPopoverBody
      canSync={dbReady && runtime.state.online && runtime.auth.isAuthenticated}
      downloads={downloads}
      onClose={close}
      onOpenView={openMiniApp}
      onSyncNow={syncNow}
      sync={sync}
      uploadingFileCount={uploadingFileCount}
    />
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
