import { DatabaseProvider, useDatabase } from "./db/DatabaseProvider";
import { createAppDatabaseWorker } from "./db/sqliteWorker";
import { Footer } from "./Footer";
import "./App.css";

interface AppProps {
  createWorker?: typeof createAppDatabaseWorker;
}

function AppContent() {
  const { status } = useDatabase();

  return (
    <div className="layout">
      <header>Header</header>
      <nav>Nav — worker: {status}</nav>
      <main>Main Content</main>
      <Footer />
    </div>
  );
}

export function App({ createWorker = createAppDatabaseWorker }: AppProps) {
  return (
    <DatabaseProvider createWorker={createWorker}>
      <AppContent />
    </DatabaseProvider>
  );
}
