import { TearleadsFrame } from "@tearleads/ui";
import { type MouseEvent, useCallback, useState } from "react";
import type { AppHostConfig } from "../../host/AppHostConfig";
import { useAppNavigationMode } from "../../navigation/useAppNavigationMode";
import type { MenuPosition } from "../shared/Menu";
import { StartMenu } from "../shared/StartMenu";
import "./Layout.css";
import { RoutedWorkspace } from "./routed/RoutedWorkspace";
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
  const navigationMode = useAppNavigationMode(hostConfig.navigationMode);
  const [split, setSplit] = useState(true);
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
    </div>
  );

  if (navigationMode === "routed") {
    return (
      <TearleadsFrame className="layout layout--routed">
        <RoutedWorkspace
          hostConfig={hostConfig}
          navigationMode={navigationMode}
        />
      </TearleadsFrame>
    );
  }

  return (
    <>
      <TearleadsFrame
        className={split ? "layout layout--split" : "layout"}
        footerEnd={footerEnd}
        footerStart={footerStart}
        headerActions={headerActions}
      >
        {WORKSPACE_IDS.map((id) => (
          <Workspace
            key={id}
            hostConfig={hostConfig}
            active={activeWorkspace === id}
            navigationMode={navigationMode}
            split={split}
          />
        ))}
      </TearleadsFrame>
      {menu && <StartMenu position={menu} onClose={closeMenu} />}
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
