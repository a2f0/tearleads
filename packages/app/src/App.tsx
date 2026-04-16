import { Layout } from "./components/layout/Layout";
import type { AppHostConfig } from "./host/AppHostConfig";

interface AppProps {
  hostConfig: AppHostConfig;
}

export function App({ hostConfig }: AppProps) {
  return <Layout hostConfig={hostConfig} />;
}
