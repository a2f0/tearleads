import { useCallback, useState } from "react";
import { DatabaseProvider, useDatabase } from "./db/DatabaseProvider";
import { createAppDatabaseWorker } from "./db/sqliteWorker";
import { Footer } from "./Footer";
import "./App.css";

interface AppProps {
  createWorker?: typeof createAppDatabaseWorker;
}

function Pane({ className }: { className: string }) {
  const { status } = useDatabase();
  return (
    <section className={className}>
      <div className="pane-content">worker: {status}</div>
      <div className="pane-footer">Pane Footer</div>
    </section>
  );
}

function AppContent({ createWorker }: Required<AppProps>) {
  const [split, setSplit] = useState(false);

  const toggleSplit = useCallback(() => setSplit((s) => !s), []);

  return (
    <div className={split ? "layout layout--split" : "layout"}>
      <header>
        <button type="button" onClick={toggleSplit}>
          {split ? "Unsplit" : "Split"}
        </button>
      </header>
      <DatabaseProvider createWorker={createWorker}>
        <Pane className="pane pane-left" />
      </DatabaseProvider>
      <DatabaseProvider createWorker={createWorker}>
        <Pane className="pane pane-right" />
      </DatabaseProvider>
      <Footer />
    </div>
  );
}

export function App({ createWorker = createAppDatabaseWorker }: AppProps) {
  return <AppContent createWorker={createWorker} />;
}
