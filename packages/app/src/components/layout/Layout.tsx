import { TearleadsFrame } from "@tearleads/ui";
import { type MouseEvent, useCallback, useEffect, useState } from "react";
import type { AppHostConfig } from "../../host/AppHostConfig";
import {
  type NavigationModeOverride,
  NavigationModeToggle,
} from "../../navigation/NavigationModeToggle";
import { useAppNavigationMode } from "../../navigation/useAppNavigationMode";
import type { MenuPosition } from "../shared/Menu";
import { StartMenu } from "../shared/StartMenu";
import "./Layout.css";
import { Workspace } from "./workspace/Workspace";
import {
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
  const navigationMode = useAppNavigationMode(
    hostConfig.navigationMode,
    modeOverride,
  );
  const [split, setSplit] = useState(hostConfig.profile.defaultSplit);
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const { activeWorkspace, setActiveWorkspace } = useWorkspace();

  const toggleSplit = useCallback(() => setSplit((s) => !s), []);
  const openStartMenu = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const headerActions = (
    <button
      className="tearleads-action-button"
      type="button"
      onClick={toggleSplit}
    >
      {split ? "Unsplit" : "Split"}
    </button>
  );
  const footerStart = (
    <button
      className="tearleads-action-button"
      type="button"
      onClick={openStartMenu}
    >
      Footer
    </button>
  );
  const modeToggle = (
    <NavigationModeToggle
      override={modeOverride}
      resolvedMode={navigationMode}
      onChange={setModeOverride}
    />
  );
  const footerEnd = (
    <div className="workspace-switcher">
      {WORKSPACE_IDS.map((id) => (
        <button
          key={id}
          type="button"
          className={`tearleads-action-button workspace-button${activeWorkspace === id ? " workspace-button--active" : ""}`}
          onClick={() => setActiveWorkspace(id)}
        >
          {id}
        </button>
      ))}
      {modeToggle}
    </div>
  );

  // One tree for both modes. The windowed↔routed switch (driven by viewport
  // resize across the breakpoint) only changes the frame chrome and each pane's
  // leaf surface — never the structure of the runtime-owning PaneProvider
  // subtrees — so React keeps those mounted and the SQLite worker / SDK client /
  // websocket / keyring session survive the toggle instead of rebooting.
  const routed = navigationMode === "routed";

  // The start menu only exists in windowed chrome; drop any open instance when
  // entering routed mode so it doesn't reappear if the viewport returns to
  // windowed.
  useEffect(() => {
    if (routed) {
      setMenu(null);
    }
  }, [routed]);

  return (
    <>
      <TearleadsFrame
        className={
          routed
            ? "layout layout--routed"
            : split
              ? "layout layout--split"
              : "layout"
        }
        footerEnd={routed ? modeToggle : footerEnd}
        footerStart={routed ? undefined : footerStart}
        headerActions={routed ? undefined : headerActions}
      >
        {WORKSPACE_IDS.map((id) => (
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
      {!routed && menu && <StartMenu position={menu} onClose={closeMenu} />}
    </>
  );
}

export function Layout({ hostConfig }: LayoutProps) {
  return (
    <WorkspaceProvider>
      <LayoutInner hostConfig={hostConfig} />
    </WorkspaceProvider>
  );
}
