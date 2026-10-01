import { useMemo } from "react";
import type { AppHostConfig } from "../../../host/AppHostConfig";
import type { AppNavigationMode } from "../../../navigation/AppNavigationMode";
import {
  DualPaneProvider,
  PaneSideProvider,
  selfPaneLabel,
} from "../../pane/dual-pane";
import { PaneProvider } from "../../pane/runtime/PaneProvider";
import { Pane } from "../../pane/shell/Pane";
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

interface WorkspacePaneProps {
  active: boolean;
  desktopLabel?: string | undefined;
  navigationMode: AppNavigationMode;
  side: "left" | "right";
  split: boolean;
}

interface WorkspacePanesProps {
  active: boolean;
  hostConfig: AppHostConfig;
  navigationMode: AppNavigationMode;
  split: boolean;
}

function createWorkspaceHostConfig({
  hostConfig,
  workspaceId,
}: {
  hostConfig: AppHostConfig;
  workspaceId: (typeof WORKSPACE_IDS)[number];
}): AppHostConfig {
  return hostConfig.withOverrides({
    localIdentityNamespace: localIdentityNamespaceForWorkspace(
      hostConfig.localIdentityNamespace,
      workspaceId,
    ),
  });
}

function PaneSurface({
  active,
  desktopLabel,
  navigationMode,
  side,
  split,
}: WorkspacePaneProps) {
  const isLeft = side === "left";
  const className = `pane pane-${side}${active ? "" : " pane-hidden"}${!isLeft && !split ? " pane-unsplit" : ""}`;

  return (
    <Pane
      active={isLeft && active}
      className={className}
      desktopLabel={desktopLabel}
      navigationMode={navigationMode}
      routedVisible={isLeft ? active : undefined}
    />
  );
}

function IsolatedWorkspacePanes(props: WorkspacePanesProps) {
  const { active, hostConfig, navigationMode, split } = props;
  const showPeerDesktopLabels =
    split &&
    navigationMode !== "routed" &&
    hostConfig.profile.features.panePeerUserIds;

  return (
    <>
      {(["left", "right"] as const).map((side) => (
        <PaneSideProvider key={side} side={side}>
          <PaneProvider autoProvisionEnabled={active} hostConfig={hostConfig}>
            <PaneSurface
              active={active}
              desktopLabel={
                showPeerDesktopLabels ? selfPaneLabel(side) : undefined
              }
              navigationMode={navigationMode}
              side={side}
              split={split}
            />
          </PaneProvider>
        </PaneSideProvider>
      ))}
    </>
  );
}

// The regular app is single-pane: it never splits, so there is only the left
// pane. In the shared policy every workspace is the *same* user looking at the
// same local data, so the runtime (identity + SQLite db) is mounted once above
// all workspaces by WorkspaceRuntimeHost (see Layout); each workspace here is
// just an alternate view that reuses it. That keeps both workspaces on one
// identity/db and means switching never tears the runtime down — it only flips
// which view is visible. Per-pane view state (open windows, route) lives in Pane.
function SharedWorkspaceView(props: {
  active: boolean;
  navigationMode: AppNavigationMode;
}) {
  const { active, navigationMode } = props;

  return (
    <PaneSideProvider side="left">
      <PaneSurface
        active={active}
        navigationMode={navigationMode}
        side="left"
        split={false}
      />
    </PaneSideProvider>
  );
}

export function Workspace(props: WorkspaceProps) {
  const { active, hostConfig, navigationMode, split, workspaceId } = props;
  // The isolated (demo) policy keeps a runtime per workspace, so it still scopes
  // the namespace by workspace id. The shared policy reuses the hoisted runtime
  // and must NOT re-scope, or it would mint a second identity/db per workspace.
  const isolated = hostConfig.profile.paneRuntimePolicy === "isolated";
  const workspaceHostConfig = useMemo(() => {
    return isolated
      ? createWorkspaceHostConfig({ hostConfig, workspaceId })
      : hostConfig;
  }, [hostConfig, isolated, workspaceId]);

  return (
    <DualPaneProvider
      peerUserIdsEnabled={workspaceHostConfig.profile.features.panePeerUserIds}
    >
      {isolated ? (
        <IsolatedWorkspacePanes
          active={active}
          hostConfig={workspaceHostConfig}
          navigationMode={navigationMode}
          split={split}
        />
      ) : (
        <SharedWorkspaceView active={active} navigationMode={navigationMode} />
      )}
    </DualPaneProvider>
  );
}
