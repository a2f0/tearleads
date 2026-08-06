import { HardDrivesIcon } from "@phosphor-icons/react/dist/csr/HardDrives";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { useMemo } from "react";
import { useWindowTitleBarAction } from "../../../components/window/WindowMenuContext";
import type { useExplorerModel } from "../hooks/useExplorerModel";
import { EXPLORER_LABELS } from "../labels";

type ExplorerModel = ReturnType<typeof useExplorerModel>;

// Toolbar navigation for the full-screen diagnostics hub. Sync stays the
// persistent entry point outside its own tab; the tab bar owns navigation among
// Sync Lanes, Blob Browser, and Write Queue once the hub is open.

function isOnSyncTab(route: ExplorerModel["routeState"]["route"]): boolean {
  return route.view === "sync-lanes" || route.view === "sync-lane-detail";
}

export function useExplorerHubToolbarActions({
  model,
  route,
}: {
  model: ExplorerModel;
  route: ExplorerModel["routeState"]["route"];
}) {
  const openSyncLanesRoute = model.routeState.openSyncLanesRoute;
  const openBlobBrowserRoute = model.routeState.openBlobBrowserRoute;
  const onSyncTab = isOnSyncTab(route);

  // The Sync entry point opens the hub (defaulting to the Sync Lanes tab); it is
  // a persistent action kept rightmost via the lowest priority among Explorer's
  // actions. On the Sync tab it steps aside for its mirror below, so each tab
  // surfaces a single one-tap switch to the other.
  const syncSectionsAction = useMemo(
    () =>
      onSyncTab
        ? null
        : {
            icon: <StackIcon aria-hidden size={18} />,
            id: "explorer-sync-sections",
            label: EXPLORER_LABELS.syncSectionsAction,
            onClick: openSyncLanesRoute,
            priority: 50,
          },
    [onSyncTab, openSyncLanesRoute],
  );

  // The mirror of the Sync entry point: while on the Sync tab, offer a one-tap
  // switch to the Blob Browser tab — matching the Sync button shown on the Blob
  // Browser tab.
  const blobBrowserSectionsAction = useMemo(
    () =>
      onSyncTab
        ? {
            icon: <HardDrivesIcon aria-hidden size={18} />,
            id: "explorer-blob-browser-sections",
            label: EXPLORER_LABELS.blobBrowserAction,
            onClick: openBlobBrowserRoute,
            priority: 60,
          }
        : null,
    [onSyncTab, openBlobBrowserRoute],
  );

  useWindowTitleBarAction(syncSectionsAction);
  useWindowTitleBarAction(blobBrowserSectionsAction);
}
