import { useMemo } from "react";
import { AppHostConfig } from "../../../host/AppHostConfig";
import type { AppNavigationMode } from "../../../navigation/AppNavigationMode";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../../pane/DualPaneProvider";
import { Pane } from "../../pane/Pane";
import { PaneProvider } from "../../pane/PaneProvider";
import {
  localIdentityNamespaceForWorkspace,
  type WORKSPACE_IDS,
} from "./WorkspaceProvider";

interface WorkspaceProps {
  hostConfig: AppHostConfig;
  active: boolean;
  navigationMode: AppNavigationMode;
  split: boolean;
  workspaceId: (typeof WORKSPACE_IDS)[number];
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
            routedVisible={active}
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
