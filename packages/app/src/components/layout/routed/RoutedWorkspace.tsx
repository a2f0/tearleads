import { useMemo } from "react";
import { AppHostConfig } from "../../../host/AppHostConfig";
import { MiniAppBusProvider } from "../../../mini-apps/bus";
import { MINI_APPS } from "../../../mini-apps/registry";
import type { AppNavigationMode } from "../../../navigation/AppNavigationMode";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../../pane/DualPaneProvider";
import { PaneProvider } from "../../pane/PaneProvider";
import { WindowStateProvider } from "../../window/WindowStateProvider";
import {
  localIdentityNamespaceForWorkspace,
  useWorkspace,
} from "../workspace/WorkspaceProvider";
import { RoutedPane } from "./RoutedPane";

interface RoutedWorkspaceProps {
  hostConfig: AppHostConfig;
  navigationMode: AppNavigationMode;
}

export function RoutedWorkspace({
  hostConfig,
  navigationMode,
}: RoutedWorkspaceProps) {
  const { activeWorkspace } = useWorkspace();
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
  // Scope the namespace the same way Workspace does so the session, keyring,
  // and SQLite database established in windowed mode survive the mode toggle.
  // Routed mode renders a single pane, so it tracks the active windowed
  // workspace and PaneProvider appends `.left` to match the default pane.
  const workspaceHostConfig = useMemo(
    () =>
      new AppHostConfig(
        apiBaseUrl,
        wsUrl,
        createSQLiteRuntime,
        createBlobStore,
        localIdentityNamespaceForWorkspace(
          localIdentityNamespace,
          activeWorkspace,
        ),
        createLocalKeyring,
        disableLocalIdentityPersistence,
        hostNavigationMode,
        storagePersistence,
      ),
    [
      activeWorkspace,
      apiBaseUrl,
      createBlobStore,
      createLocalKeyring,
      createSQLiteRuntime,
      disableLocalIdentityPersistence,
      hostNavigationMode,
      localIdentityNamespace,
      storagePersistence,
      wsUrl,
    ],
  );

  return (
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={workspaceHostConfig}>
          <WindowStateProvider>
            <AppNavigationProvider mode={navigationMode} miniApps={MINI_APPS}>
              <MiniAppBusProvider>
                <RoutedPane />
              </MiniAppBusProvider>
            </AppNavigationProvider>
          </WindowStateProvider>
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>
  );
}
