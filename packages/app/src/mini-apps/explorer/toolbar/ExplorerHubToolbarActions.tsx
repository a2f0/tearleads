import { HardDrivesIcon } from "@phosphor-icons/react/dist/csr/HardDrives";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { useWindowTitleBarAction } from "../../../components/window/WindowMenuContext";
import type { useExplorerModel } from "../hooks/useExplorerModel";
import { EXPLORER_LABELS } from "../labels";

type ExplorerModel = ReturnType<typeof useExplorerModel>;

// Stable icon elements so an unchanged action structurally matches its
// registration across renders (the registry compares fields with Object.is).
const BLOB_BROWSER_ICON = <HardDrivesIcon aria-hidden size={18} />;
const SYNC_SECTIONS_ICON = <StackIcon aria-hidden size={18} />;

// Toolbar navigation for the full-screen diagnostics hub. The Sync entry point
// opens the hub (defaulting to the Sync Lanes tab) and is kept rightmost via
// the lowest priority among Explorer's actions; the tab bar owns navigation
// among the hub's tabs once it is open. On the Sync tab the entry point steps
// aside for its Blob Browser mirror, so each tab surfaces a single one-tap
// switch to the other.
export function useExplorerHubToolbarActions({
  model,
  route,
}: {
  model: ExplorerModel;
  route: ExplorerModel["routeState"]["route"];
}) {
  const onSyncTab =
    route.view === "sync-lanes" || route.view === "sync-lane-detail";

  useWindowTitleBarAction(
    onSyncTab
      ? null
      : {
          icon: SYNC_SECTIONS_ICON,
          id: "explorer-sync-sections",
          label: EXPLORER_LABELS.syncSectionsAction,
          onClick: model.routeState.openSyncLanesRoute,
          priority: 50,
        },
  );
  useWindowTitleBarAction(
    onSyncTab
      ? {
          icon: BLOB_BROWSER_ICON,
          id: "explorer-blob-browser-sections",
          label: EXPLORER_LABELS.blobBrowserAction,
          onClick: model.routeState.openBlobBrowserRoute,
          priority: 60,
        }
      : null,
  );
}
