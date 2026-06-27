import { useMemo } from "react";
import type { AppHostConfig } from "../../../host/AppHostConfig";
import type { AppNavigationMode } from "../../../navigation/AppNavigationMode";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../../pane/DualPaneProvider";
import { Pane } from "../../pane/Pane";
import { PaneProvider, SharedPaneProvider } from "../../pane/PaneProvider";
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
  navigationMode,
  side,
  split,
}: WorkspacePaneProps) {
  const isLeft = side === "left";
  const className = `pane pane-${side}${active ? "" : " pane-hidden"}${!isLeft && !split ? " pane-unsplit" : ""}`;

  return (
    <Pane
      className={className}
      navigationMode={navigationMode}
      routedVisible={isLeft ? active : undefined}
    />
  );
}

function WorkspacePane(props: WorkspacePaneProps) {
  return (
    <PaneSideProvider side={props.side}>
      <PaneSurface {...props} />
    </PaneSideProvider>
  );
}

function IsolatedWorkspacePanes(props: WorkspacePanesProps) {
  const { active, hostConfig, navigationMode, split } = props;

  return (
    <>
      <PaneSideProvider side="left">
        <PaneProvider autoProvisionEnabled={active} hostConfig={hostConfig}>
          <PaneSurface
            active={active}
            navigationMode={navigationMode}
            side="left"
            split={split}
          />
        </PaneProvider>
      </PaneSideProvider>
      <PaneSideProvider side="right">
        <PaneProvider autoProvisionEnabled={active} hostConfig={hostConfig}>
          <PaneSurface
            active={active}
            navigationMode={navigationMode}
            side="right"
            split={split}
          />
        </PaneProvider>
      </PaneSideProvider>
    </>
  );
}

// The regular app is single-pane: it never splits, so there is only the left
// pane. SharedPaneProvider keeps the pane on the workspace runtime (and its
// persistence namespace) directly, without the per-side `.left`/`.right` split
// that the isolated peer panes use.
function SingleWorkspacePane(props: WorkspacePanesProps) {
  const { active, hostConfig, navigationMode } = props;

  return (
    <SharedPaneProvider autoProvisionEnabled={active} hostConfig={hostConfig}>
      <WorkspacePane
        active={active}
        navigationMode={navigationMode}
        side="left"
        split={false}
      />
    </SharedPaneProvider>
  );
}

export function Workspace(props: WorkspaceProps) {
  const { active, hostConfig, navigationMode, split, workspaceId } = props;
  const workspaceHostConfig = useMemo(() => {
    return createWorkspaceHostConfig({ hostConfig, workspaceId });
  }, [hostConfig, workspaceId]);
  const WorkspacePanes =
    workspaceHostConfig.profile.paneRuntimePolicy === "isolated"
      ? IsolatedWorkspacePanes
      : SingleWorkspacePane;

  return (
    <DualPaneProvider
      peerUserIdsEnabled={workspaceHostConfig.profile.features.panePeerUserIds}
    >
      <WorkspacePanes
        active={active}
        hostConfig={workspaceHostConfig}
        navigationMode={navigationMode}
        split={split}
      />
    </DualPaneProvider>
  );
}
