import type { PropsWithChildren } from "react";
import { useMemo } from "react";
import type { AppHostConfig } from "../../../host/AppHostConfig";
import { AppHostConfig as PaneAppHostConfig } from "../../../host/AppHostConfig";
import { AppRuntimeProvider } from "../../../providers/AppRuntimeProvider";
import { usePaneSide } from "../DualPaneProvider";

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
    disableLocalIdentityPersistence,
    localIdentityNamespace,
    navigationMode,
    profile,
    storagePersistence,
    wsUrl,
  } = hostConfig;
  const paneLocalIdentityNamespace = disableLocalIdentityPersistence
    ? undefined
    : `${localIdentityNamespace ?? "tearleads.pane"}.${side}`;
  const paneHostConfig = useMemo(
    () =>
      new PaneAppHostConfig(
        apiBaseUrl,
        wsUrl,
        createSQLiteRuntime,
        createBlobStore,
        paneLocalIdentityNamespace,
        createLocalKeyring,
        disableLocalIdentityPersistence,
        navigationMode,
        storagePersistence,
        profile,
      ),
    // localIdentityNamespace and side are intentionally omitted: they only feed
    // paneLocalIdentityNamespace (above), which is itself a dependency.
    [
      apiBaseUrl,
      createBlobStore,
      createLocalKeyring,
      createSQLiteRuntime,
      disableLocalIdentityPersistence,
      navigationMode,
      paneLocalIdentityNamespace,
      profile,
      storagePersistence,
      wsUrl,
    ],
  );

  return (
    <AppRuntimeProvider hostConfig={paneHostConfig}>
      {children}
    </AppRuntimeProvider>
  );
}

export function SharedPaneProvider({
  children,
  hostConfig,
}: PaneProviderProps) {
  return (
    <AppRuntimeProvider hostConfig={hostConfig}>{children}</AppRuntimeProvider>
  );
}
