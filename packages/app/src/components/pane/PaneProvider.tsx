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
  const paneHostConfig = useMemo(
    () =>
      new PaneAppHostConfig(
        hostConfig.apiBaseUrl,
        hostConfig.wsUrl,
        hostConfig.createSQLiteRuntime,
        hostConfig.createBlobStore,
        `${hostConfig.localIdentityNamespace ?? "tearleads.pane"}.${side}`,
        hostConfig.createLocalKeyring,
      ),
    [hostConfig, side],
  );

  return (
    <AppRuntimeProvider hostConfig={paneHostConfig}>
      {children}
    </AppRuntimeProvider>
  );
}
