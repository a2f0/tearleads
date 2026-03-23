import { createAppDatabaseWorker } from "./db/sqliteWorker";
import { Layout } from "./Layout";

interface AppProps {
  createWorker?: typeof createAppDatabaseWorker;
}

export function App({ createWorker = createAppDatabaseWorker }: AppProps) {
  return <Layout createWorker={createWorker} />;
}
