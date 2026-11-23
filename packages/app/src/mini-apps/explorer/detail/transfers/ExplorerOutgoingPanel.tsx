import { requestAllDomainSyncLanes } from "@tearleads/client-sdk";
import { useWindowRefreshMenuItem } from "@tearleads/windowing";
import {
  type ComponentProps,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import {
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
} from "../../../../components/mini-app/MiniAppLayout";
import type { ExplorerUploadManager } from "../../hooks/useExplorerUploadManager";
import { EXPLORER_LABELS } from "../../labels";
import type { ExplorerOutgoingSection } from "../../routes";
import { ExplorerWriteQueuePanel } from "../sync/ExplorerWriteQueuePanel";
import { getOutgoingSectionSelector } from "./ExplorerOutgoingSectionFrame";
import { ExplorerUploadsPanel } from "./ExplorerUploadsPanel";
import { pinSectionToTop } from "./pinSectionToTop";

interface ExplorerOutgoingPanelProps
  extends ComponentProps<typeof ExplorerWriteQueuePanel> {
  /** The section a link asked to scroll to the top, or null for the top. */
  section: ExplorerOutgoingSection | null;
  uploadManager: ExplorerUploadManager;
}

// A link into one section (the Sync Status popover's) scrolls that section's
// heading to the top of the tab, since another section may sit above it. A
// layout effect, so the tab never paints at its top first.
function useOutgoingSectionScroll(
  panelRef: RefObject<HTMLDivElement | null>,
  section: ExplorerOutgoingSection | null,
) {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel === null || section === null) return undefined;
    return pinSectionToTop(panel, getOutgoingSectionSelector(section));
  }, [panelRef, section]);
}

/**
 * The diagnostics hub's Outgoing tab: what waits to leave this device. One
 * scroller holds the Uploads section and the Write Queue section; a selected
 * write-queue entry replaces both with its detail. The tab, not a section,
 * owns Refresh, so it stays on the entry detail too.
 */
export function ExplorerOutgoingPanel({
  section,
  uploadManager,
  ...writeQueue
}: ExplorerOutgoingPanelProps) {
  const { domainScope, isAuthenticated, online, selectedEntryKey } = writeQueue;
  const listing = selectedEntryKey === null;
  const panelRef = useRef<HTMLDivElement>(null);
  useOutgoingSectionScroll(panelRef, listing ? section : null);
  const handleRefresh = useCallback(
    () => requestAllDomainSyncLanes(domainScope),
    [domainScope],
  );
  // The same Refresh as Incoming: re-request sync for the scope, which
  // re-drives each imported file's existing upload (never re-importing it)
  // and every queued write, an entry's included.
  useWindowRefreshMenuItem({
    disabled: !online || !isAuthenticated,
    onRefresh: handleRefresh,
    priority: 200,
  });

  // The write queue keeps its position among the children, so opening an
  // entry does not remount it.
  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--outgoing"
      ref={panelRef}
      scroll
    >
      {listing ? (
        <MiniAppHeader>
          <MiniAppHeaderCopy>
            <strong>{EXPLORER_LABELS.outgoingAction}</strong>
            <span>{EXPLORER_LABELS.outgoingDescription}</span>
          </MiniAppHeaderCopy>
        </MiniAppHeader>
      ) : null}
      {listing ? (
        <ExplorerUploadsPanel
          domainScope={domainScope}
          uploadManager={uploadManager}
        />
      ) : null}
      <ExplorerWriteQueuePanel {...writeQueue} />
    </MiniAppPanel>
  );
}
