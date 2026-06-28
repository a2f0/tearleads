import { TearleadsFrame } from "@tearleads/ui";
import { useCallback, useState } from "react";
import type { AppHostConfig } from "../../host/AppHostConfig";
import {
  SystemMonitorDeveloperModeProvider,
  useSystemMonitorDeveloperMode,
} from "../../mini-apps/system-monitor/systemMonitorDeveloperMode";
import {
  type NavigationModeOverride,
  NavigationModeToggle,
} from "../../navigation/NavigationModeToggle";
import { useAppNavigationMode } from "../../navigation/useAppNavigationMode";
import "./Layout.css";
import { Workspace } from "./workspace/Workspace";
import {
  SINGLE_WORKSPACE_IDS,
  useWorkspace,
  WORKSPACE_IDS,
  WorkspaceProvider,
} from "./workspace/WorkspaceProvider";

interface LayoutProps {
  hostConfig: AppHostConfig;
}

function LayoutInner({ hostConfig }: LayoutProps) {
  const [modeOverride, setModeOverride] =
    useState<NavigationModeOverride>(null);
  const { isDeveloperMode } = useSystemMonitorDeveloperMode();
  const navigationMode = useAppNavigationMode(
    hostConfig.navigationMode,
    isDeveloperMode ? modeOverride : null,
  );
  const [split, setSplit] = useState(hostConfig.profile.defaultSplit);
  const { activeWorkspace, workspaceIds } = useWorkspace();
  const toggleSplit = useCallback(() => setSplit((s) => !s), []);

  // Only peer profiles (the demo) split: the second pane is the peer, so the
  // toggle shows/hides it. The regular app is single-pane and has no toggle.
  const peerPanes = hostConfig.profile.features.panePeerUserIds;
  const routed = navigationMode === "routed";

  const headerActions = (
    <>
      {peerPanes && !routed && (
        <button
          className="tearleads-action-button"
          type="button"
          onClick={toggleSplit}
        >
          {split ? "Hide Peer" : "Show Peer"}
        </button>
      )}
      {isDeveloperMode && (
        <NavigationModeToggle
          override={modeOverride}
          resolvedMode={navigationMode}
          onChange={setModeOverride}
        />
      )}
    </>
  );

  // One tree for both modes. The windowed↔routed switch (driven by viewport
  // resize across the breakpoint) only changes the frame chrome and each pane's
  // leaf surface — never the structure of the runtime-owning PaneProvider
  // subtrees — so React keeps those mounted and the SQLite worker / SDK client /
  // websocket / keyring session survive the toggle instead of rebooting.
  return (
    <TearleadsFrame
      className={
        routed
          ? "layout layout--routed"
          : split
            ? "layout layout--split"
            : "layout"
      }
      headerActions={headerActions}
    >
      {workspaceIds.map((id) => (
        <Workspace
          key={id}
          hostConfig={hostConfig}
          active={activeWorkspace === id}
          navigationMode={navigationMode}
          split={split}
          workspaceId={id}
        />
      ))}
    </TearleadsFrame>
  );
}

export function Layout({ hostConfig }: LayoutProps) {
  const workspaceIds = hostConfig.profile.features.panePeerUserIds
    ? SINGLE_WORKSPACE_IDS
    : WORKSPACE_IDS;

  return (
    <SystemMonitorDeveloperModeProvider>
      <WorkspaceProvider workspaceIds={workspaceIds}>
        <LayoutInner hostConfig={hostConfig} />
      </WorkspaceProvider>
    </SystemMonitorDeveloperModeProvider>
  );
}
