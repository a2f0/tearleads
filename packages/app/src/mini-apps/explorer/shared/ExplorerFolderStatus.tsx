import { AccountBootstrapLoadingPanel } from "../../../components/identity/AccountBootstrapLoadingPanel";
import { MiniAppStatePanel } from "../../../components/mini-app/MiniAppLayout";

export type ExplorerFolderState =
  | "loading"
  | "syncing"
  | "unavailable"
  | "empty"
  | "available";

/**
 * What the folder pane shows when no folder is selected. Online, it is
 * `syncing` while a listing or refresh is in flight or sync is still working
 * (sync pulls a folder's details once the listing finds it), so a restore or
 * a first sync does not ask the user to refresh while folders are still
 * arriving. Otherwise known folders without names are `unavailable`.
 */
export function resolveExplorerFolderState(input: {
  count: number;
  knownCount: number;
  online: boolean;
  ready: boolean;
  /** Explorer is listing folders: a hydration or a refresh is in flight. */
  refreshing: boolean;
  startupPending: boolean;
  /** Sync has healthy work running or requested (`hasActiveSyncWork`). */
  syncActive: boolean;
}): ExplorerFolderState {
  if (input.count > 0) return "available";
  if (!input.ready || input.startupPending) return "loading";
  if (input.online && (input.refreshing || input.syncActive)) return "syncing";
  return input.knownCount > 0 ? "unavailable" : "empty";
}

export function ExplorerFolderStatus({
  state,
}: {
  state: ExplorerFolderState;
}) {
  switch (state) {
    case "loading":
      return (
        <AccountBootstrapLoadingPanel
          title="Loading your workspace"
          description="Opening your saved folders on this device."
        />
      );
    case "syncing":
      return (
        <MiniAppStatePanel
          busy
          title="Syncing folders"
          description="Checking for folders you can access."
        />
      );
    case "unavailable":
      return (
        <MiniAppStatePanel
          title="Folder details unavailable"
          description="Refresh Explorer when you’re online to load folder names."
        />
      );
    case "empty":
      return (
        <MiniAppStatePanel
          title="No folders on this device"
          description="Refresh Explorer when you’re online to check for folders you can access."
        />
      );
    case "available":
      return (
        <MiniAppStatePanel
          title="Select a folder"
          description="Choose a folder to see its contents."
        />
      );
  }
}
