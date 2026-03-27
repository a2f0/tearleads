import type { AppHostConfig } from "./host/AppHostConfig";
import { Layout } from "./Layout";

interface AppProps {
  hostConfig: AppHostConfig;
}

export function App({ hostConfig }: AppProps) {
  return <Layout hostConfig={hostConfig} />;
}
