import { useCallback, useState } from "react";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "./components/pane/DualPaneProvider";
import { Pane } from "./components/pane/Pane";
import { PaneProvider } from "./components/pane/PaneProvider";
import { Footer } from "./Footer";
import type { AppHostConfig } from "./host/AppHostConfig";
import "./App.css";

interface LayoutProps {
  hostConfig: AppHostConfig;
}

export function Layout({ hostConfig }: LayoutProps) {
  const [split, setSplit] = useState(true);

  const toggleSplit = useCallback(() => setSplit((s) => !s), []);

  return (
    <div className={split ? "layout layout--split" : "layout"}>
      <header>
        <button type="button" onClick={toggleSplit}>
          {split ? "Unsplit" : "Split"}
        </button>
      </header>
      <DualPaneProvider>
        <PaneSideProvider side="left">
          <PaneProvider hostConfig={hostConfig}>
            <Pane className="pane pane-left" />
          </PaneProvider>
        </PaneSideProvider>
        <PaneSideProvider side="right">
          <PaneProvider hostConfig={hostConfig}>
            <Pane className="pane pane-right" />
          </PaneProvider>
        </PaneSideProvider>
      </DualPaneProvider>
      <Footer />
    </div>
  );
}
