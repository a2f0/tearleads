import { useMemo } from "react";
import { AppHostConfig } from "../../../host/AppHostConfig";
import type { AppNavigationMode } from "../../../navigation/AppNavigationMode";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../../pane/DualPaneProvider";
import { Pane } from "../../pane/Pane";
import { PaneProvider } from "../../pane/PaneProvider";
import type { WORKSPACE_IDS } from "./WorkspaceProvider";

interface WorkspaceProps {
  hostConfig: AppHostConfig;
  active: boolean;
  navigationMode: AppNavigationMode;
  split: boolean;
  workspaceId: (typeof WORKSPACE_IDS)[number];
}

function localIdentityNamespaceForWorkspace(
  baseNamespace: string | undefined,
  workspaceId: (typeof WORKSPACE_IDS)[number],
): string {
  // Workspaces are mounted concurrently even when hidden, so each workspace
  // needs its own namespace before PaneProvider appends `.left` / `.right`;
  // otherwise hidden panes can restore the same identity and race the visible
  // pane for the same persistent SQLite database.
  return `${baseNamespace ?? "tearleads.pane"}.workspace-${workspaceId}`;
}

export function Workspace({
  hostConfig,
  active,
  navigationMode,
  split,
  workspaceId,
}: WorkspaceProps) {
  const {
    apiBaseUrl,
    createBlobStore,
    createLocalKeyring,
    createSQLiteRuntime,
    disableLocalIdentityPersistence,
    localIdentityNamespace,
    navigationMode: hostNavigationMode,
    storagePersistence,
    wsUrl,
  } = hostConfig;
  const workspaceHostConfig = useMemo(() => {
    return new AppHostConfig(
      apiBaseUrl,
      wsUrl,
      createSQLiteRuntime,
      createBlobStore,
      localIdentityNamespaceForWorkspace(localIdentityNamespace, workspaceId),
      createLocalKeyring,
      disableLocalIdentityPersistence,
      hostNavigationMode,
      storagePersistence,
    );
  }, [
    apiBaseUrl,
    createBlobStore,
    createLocalKeyring,
    createSQLiteRuntime,
    disableLocalIdentityPersistence,
    hostNavigationMode,
    localIdentityNamespace,
    storagePersistence,
    workspaceId,
    wsUrl,
  ]);

  return (
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={workspaceHostConfig}>
          <Pane
            className={`pane pane-left${active ? "" : " pane-hidden"}`}
            navigationMode={navigationMode}
          />
        </PaneProvider>
      </PaneSideProvider>
      <PaneSideProvider side="right">
        <PaneProvider hostConfig={workspaceHostConfig}>
          <Pane
            className={`pane pane-right${active ? "" : " pane-hidden"}${!split ? " pane-unsplit" : ""}`}
            navigationMode={navigationMode}
          />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>
  );
}
