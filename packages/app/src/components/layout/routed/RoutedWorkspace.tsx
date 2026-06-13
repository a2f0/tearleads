import type { AppHostConfig } from "../../../host/AppHostConfig";
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
import { RoutedPane } from "./RoutedPane";

interface RoutedWorkspaceProps {
  hostConfig: AppHostConfig;
  navigationMode: AppNavigationMode;
}

export function RoutedWorkspace({
  hostConfig,
  navigationMode,
}: RoutedWorkspaceProps) {
  return (
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
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
