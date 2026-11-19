import { AccountBootstrapLoadingPanel } from "../../../components/identity/AccountBootstrapLoadingPanel";
import { MiniAppStatePanel } from "../../../components/mini-app/MiniAppLayout";

export type ExplorerFolderState =
  | "loading"
  | "syncing"
  | "unavailable"
  | "empty"
  | "available";

export function resolveExplorerFolderState(input: {
  count: number;
  knownCount: number;
  ready: boolean;
  startupPending: boolean;
  syncing: boolean;
}): ExplorerFolderState {
  if (input.count > 0) return "available";
  if (!input.ready || input.startupPending) return "loading";
  if (input.syncing) return "syncing";
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
