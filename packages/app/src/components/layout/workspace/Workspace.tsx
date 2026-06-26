import { useMemo } from "react";
import { AppHostConfig } from "../../../host/AppHostConfig";
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

function createWorkspaceHostConfig({
  hostConfig,
  workspaceId,
}: {
  hostConfig: AppHostConfig;
  workspaceId: (typeof WORKSPACE_IDS)[number];
}): AppHostConfig {
  return new AppHostConfig(
    hostConfig.apiBaseUrl,
    hostConfig.wsUrl,
    hostConfig.createSQLiteRuntime,
    hostConfig.createBlobStore,
    localIdentityNamespaceForWorkspace(
      hostConfig.localIdentityNamespace,
      workspaceId,
    ),
    hostConfig.createLocalKeyring,
    hostConfig.disableLocalIdentityPersistence,
    hostConfig.navigationMode,
    hostConfig.storagePersistence,
    hostConfig.profile,
  );
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

function IsolatedWorkspacePanes(props: {
  active: boolean;
  hostConfig: AppHostConfig;
  navigationMode: AppNavigationMode;
  split: boolean;
}) {
  const { active, hostConfig, navigationMode, split } = props;

  return (
    <>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
          <PaneSurface
            active={active}
            navigationMode={navigationMode}
            side="left"
            split={split}
          />
        </PaneProvider>
      </PaneSideProvider>
      <PaneSideProvider side="right">
        <PaneProvider hostConfig={hostConfig}>
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

function SharedWorkspacePanes(props: {
  active: boolean;
  hostConfig: AppHostConfig;
  navigationMode: AppNavigationMode;
  split: boolean;
}) {
  const { active, hostConfig, navigationMode, split } = props;

  return (
    <SharedPaneProvider hostConfig={hostConfig}>
      <WorkspacePane
        active={active}
        navigationMode={navigationMode}
        side="left"
        split={split}
      />
      <WorkspacePane
        active={active}
        navigationMode={navigationMode}
        side="right"
        split={split}
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
      : SharedWorkspacePanes;

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
