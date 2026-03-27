import { createAppDatabaseWorker } from "./db/sqliteWorker";
import type { AppHostConfig } from "./host/AppHostConfig";
import { Layout } from "./Layout";

interface AppProps {
  createWorker?: typeof createAppDatabaseWorker;
  hostConfig: AppHostConfig;
}

export function App({
  createWorker = createAppDatabaseWorker,
  hostConfig,
}: AppProps) {
  return <Layout createWorker={createWorker} hostConfig={hostConfig} />;
}
