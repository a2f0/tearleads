import { useCallback, useState } from "react";
import "../../App.css";
import type { AppHostConfig } from "../../host/AppHostConfig";
import "./Layout.css";
import { Footer } from "./Footer";
import { Header } from "./Header";
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
  const [split, setSplit] = useState(true);
  const { activeWorkspace } = useWorkspace();

  const toggleSplit = useCallback(() => setSplit((s) => !s), []);

  return (
    <div className={split ? "layout layout--split" : "layout"}>
      <Header split={split} onToggleSplit={toggleSplit} />
      {WORKSPACE_IDS.map((id) => (
        <Workspace
          key={id}
          hostConfig={hostConfig}
          active={activeWorkspace === id}
          split={split}
        />
      ))}
      <Footer />
    </div>
  );
}

export function Layout({ hostConfig }: LayoutProps) {
  return (
    <WorkspaceProvider>
      <LayoutInner hostConfig={hostConfig} />
    </WorkspaceProvider>
  );
}
