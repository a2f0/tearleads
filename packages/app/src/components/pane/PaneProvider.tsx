import type { PropsWithChildren } from "react";
import { useMemo } from "react";
import type { AppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfig as PaneAppHostConfig } from "../../host/AppHostConfig";
import { AppRuntimeProvider } from "../../providers/AppRuntimeProvider";
import { usePaneSide } from "./DualPaneProvider";

interface PaneProviderProps extends PropsWithChildren {
  hostConfig: AppHostConfig;
}

export function PaneProvider({ children, hostConfig }: PaneProviderProps) {
  const side = usePaneSide();
  const {
    apiBaseUrl,
    createBlobStore,
    createLocalKeyring,
    createSQLiteRuntime,
    localIdentityNamespace,
    wsUrl,
  } = hostConfig;
  const paneHostConfig = useMemo(
    () =>
      new PaneAppHostConfig(
        apiBaseUrl,
        wsUrl,
        createSQLiteRuntime,
        createBlobStore,
        `${localIdentityNamespace ?? "tearleads.pane"}.${side}`,
        createLocalKeyring,
      ),
    [
      apiBaseUrl,
      createBlobStore,
      createLocalKeyring,
      createSQLiteRuntime,
      localIdentityNamespace,
      side,
      wsUrl,
    ],
  );

  return (
    <AppRuntimeProvider hostConfig={paneHostConfig}>
      {children}
    </AppRuntimeProvider>
  );
}
