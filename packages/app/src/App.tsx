import { DatabaseProvider, useDatabase } from "./db/DatabaseProvider";
import { createAppDatabaseWorker } from "./db/sqliteWorker";

interface AppProps {
  createWorker?: typeof createAppDatabaseWorker;
}

function AppContent() {
  const { status } = useDatabase();

  return <div>App worker: {status}</div>;
}

export function App({ createWorker = createAppDatabaseWorker }: AppProps) {
  return (
    <DatabaseProvider createWorker={createWorker}>
      <AppContent />
    </DatabaseProvider>
  );
}
