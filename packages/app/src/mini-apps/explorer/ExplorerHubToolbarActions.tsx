import { HardDrivesIcon } from "@phosphor-icons/react/dist/csr/HardDrives";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { useMemo } from "react";
import { useWindowTitleBarAction } from "../../components/window/WindowMenuContext";
import type { useExplorerModel } from "./hooks/useExplorerModel";
import { EXPLORER_LABELS } from "./labels";

type ExplorerModel = ReturnType<typeof useExplorerModel>;

// Toolbar navigation for the full-screen Sync Lanes / Blob Browser hub: a
// mirrored pair of actions so each tab surfaces a single one-tap switch to the
// other, matching the hub's tab bar.

function isOnSyncTab(route: ExplorerModel["routeState"]["route"]): boolean {
  return route.view === "sync-lanes" || route.view === "sync-lane-detail";
}

export function useExplorerSyncSectionsToolbarAction({
  model,
  route,
}: {
  model: ExplorerModel;
  route: ExplorerModel["routeState"]["route"];
}) {
  const openSyncLanesRoute = model.routeState.openSyncLanesRoute;
  // Within the hub's Sync tab the mirror "Blob Browser" action provides the
  // tab switch, so this entry point steps aside there. It stays on every other
  // route — including the hub's Blob Browser tab, where it switches back to Sync.
  const onSyncTab = isOnSyncTab(route);
  const syncSectionsAction = useMemo(
    () =>
      onSyncTab
        ? null
        : {
            // Opens the full-screen Sync Lanes / Blob Browser hub (defaulting to
            // the Sync Lanes tab). A persistent entry point, kept rightmost in
            // the toolbar via the lowest priority among Explorer's actions.
            icon: <StackIcon aria-hidden size={18} />,
            id: "explorer-sync-sections",
            label: EXPLORER_LABELS.syncSectionsAction,
            onClick: openSyncLanesRoute,
            priority: 50,
          },
    [onSyncTab, openSyncLanesRoute],
  );

  useWindowTitleBarAction(syncSectionsAction);
}

export function useExplorerBlobBrowserSectionsToolbarAction({
  model,
  route,
}: {
  model: ExplorerModel;
  route: ExplorerModel["routeState"]["route"];
}) {
  const openBlobBrowserRoute = model.routeState.openBlobBrowserRoute;
  // The mirror of the Sync entry point: while on the hub's Sync tab, offer a
  // one-tap switch to the Blob Browser tab — matching the Sync button shown on
  // the Blob Browser tab.
  const onSyncTab = isOnSyncTab(route);
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

  useWindowTitleBarAction(blobBrowserSectionsAction);
}
