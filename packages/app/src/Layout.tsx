import { useCallback, useState } from "react";
import { Pane } from "./components/pane/Pane";
import { PaneProvider } from "./components/pane/PaneProvider";
import type { createAppDatabaseWorker } from "./db/sqliteWorker";
import { Footer } from "./Footer";
import "./App.css";

interface LayoutProps {
  createWorker: typeof createAppDatabaseWorker;
}

export function Layout({ createWorker }: LayoutProps) {
  const [split, setSplit] = useState(true);

  const toggleSplit = useCallback(() => setSplit((s) => !s), []);

  return (
    <div className={split ? "layout layout--split" : "layout"}>
      <header>
        <button type="button" onClick={toggleSplit}>
          {split ? "Unsplit" : "Split"}
        </button>
      </header>
      <PaneProvider createWorker={createWorker}>
        <Pane className="pane pane-left" />
      </PaneProvider>
      <PaneProvider createWorker={createWorker}>
        <Pane className="pane pane-right" />
      </PaneProvider>
      <Footer />
    </div>
  );
}
