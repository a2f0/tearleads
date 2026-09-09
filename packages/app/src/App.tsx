import { Layout } from "./components/layout/Layout";
import { AppErrorBoundary } from "./components/shared/AppErrorBoundary";
import type { AppHostConfig } from "./host/AppHostConfig";
import { DiagnosticsProvider } from "./providers/logging/DiagnosticsProvider";

interface AppProps {
  hostConfig: AppHostConfig;
}

export function App({ hostConfig }: AppProps) {
  return (
    <DiagnosticsProvider value={hostConfig.diagnostics}>
      <AppErrorBoundary area="app" diagnostics={hostConfig.diagnostics}>
        <Layout hostConfig={hostConfig} />
      </AppErrorBoundary>
    </DiagnosticsProvider>
  );
}
