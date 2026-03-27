import { useCallback, useState } from "react";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "./components/pane/DualPaneProvider";
import { Pane } from "./components/pane/Pane";
import { PaneProvider } from "./components/pane/PaneProvider";
import { Footer } from "./Footer";
import type { AppHostConfig } from "./host/AppHostConfig";
import { useWorkspace, WorkspaceProvider } from "./WorkspaceProvider";
import "./App.css";

interface LayoutProps {
  hostConfig: AppHostConfig;
}

function Workspace({
  hostConfig,
  active,
  split,
}: {
  hostConfig: AppHostConfig;
  active: boolean;
  split: boolean;
}) {
  return (
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
          <Pane className={`pane pane-left${active ? "" : " pane-hidden"}`} />
        </PaneProvider>
      </PaneSideProvider>
      <PaneSideProvider side="right">
        <PaneProvider hostConfig={hostConfig}>
          <Pane
            className={`pane pane-right${active ? "" : " pane-hidden"}${!split ? " pane-unsplit" : ""}`}
          />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>
  );
}

function LayoutInner({ hostConfig }: LayoutProps) {
  const [split, setSplit] = useState(true);
  const { activeWorkspace } = useWorkspace();

  const toggleSplit = useCallback(() => setSplit((s) => !s), []);

  return (
    <div className={split ? "layout layout--split" : "layout"}>
      <header>
        <button type="button" onClick={toggleSplit}>
          {split ? "Unsplit" : "Split"}
        </button>
      </header>
      <Workspace
        hostConfig={hostConfig}
        active={activeWorkspace === 1}
        split={split}
      />
      <Workspace
        hostConfig={hostConfig}
        active={activeWorkspace === 2}
        split={split}
      />
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
