import { TearleadsFrame } from "@tearleads/ui";
import { type PropsWithChildren, useCallback, useMemo, useState } from "react";
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
import { AppRuntimeProvider } from "../../providers/AppRuntimeProvider";
import { AppFeatureFlagsProvider } from "../../providers/feature-flags/AppFeatureFlagsProvider";
import { BillingBanner } from "./BillingBanner";
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

// The single app-wide identity namespace for the shared runtime policy. Every
// workspace and pane reuses the one hoisted runtime, so its persisted identity
// (and SQLite db) live under one stable namespace rather than a per-pane one.
const SHARED_RUNTIME_LOCAL_IDENTITY_NAMESPACE = "tearleads.app";

// The shared policy mounts ONE runtime (identity + SQLite db) above every
// workspace, so all workspaces are the same user on the same local database and
// switching never tears the db down. The isolated (demo) policy keeps a runtime
// per workspace (see Workspace), so it passes the workspaces through unwrapped.
function WorkspaceRuntimeHost({
  children,
  hostConfig,
}: PropsWithChildren<{ hostConfig: AppHostConfig }>) {
  // The isolated policy scopes the namespace per pane via PaneProvider, and the
  // shared runtime here must do the equivalent or local identity persistence is
  // disabled: useLocalIdentityPersistence returns null for an undefined
  // namespace, so the identity (and database) would be regenerated on every
  // reload instead of restored. Only fall back to the stable app-wide namespace
  // for the shared policy when the host left it unset; honor
  // disableLocalIdentityPersistence by leaving it unset, exactly as PaneProvider
  // does. The isolated policy never reads this (it returns children below), so
  // skip the override work for it too.
  const sharedHostConfig = useMemo(() => {
    if (
      hostConfig.profile.paneRuntimePolicy === "isolated" ||
      hostConfig.disableLocalIdentityPersistence ||
      hostConfig.localIdentityNamespace != null
    ) {
      return hostConfig;
    }
    return hostConfig.withOverrides({
      localIdentityNamespace: SHARED_RUNTIME_LOCAL_IDENTITY_NAMESPACE,
    });
  }, [hostConfig]);

  if (hostConfig.profile.paneRuntimePolicy === "isolated") {
    return <>{children}</>;
  }

  return (
    <AppRuntimeProvider hostConfig={sharedHostConfig}>
      <BillingBanner />
      {children}
    </AppRuntimeProvider>
  );
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
  const demoPeerSplit = peerPanes && split && !routed;

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
          : demoPeerSplit
            ? "layout layout--split layout--demo-peer-split"
            : split
              ? "layout layout--split"
              : "layout"
      }
      headerActions={headerActions}
    >
      <WorkspaceRuntimeHost hostConfig={hostConfig}>
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
      </WorkspaceRuntimeHost>
    </TearleadsFrame>
  );
}

export function Layout({ hostConfig }: LayoutProps) {
  const workspaceIds = hostConfig.profile.features.panePeerUserIds
    ? SINGLE_WORKSPACE_IDS
    : WORKSPACE_IDS;

  return (
    <SystemMonitorDeveloperModeProvider>
      <AppFeatureFlagsProvider>
        <WorkspaceProvider workspaceIds={workspaceIds}>
          <LayoutInner hostConfig={hostConfig} />
        </WorkspaceProvider>
      </AppFeatureFlagsProvider>
    </SystemMonitorDeveloperModeProvider>
  );
}
