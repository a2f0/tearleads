import type { PropsWithChildren } from "react";
import { useMemo } from "react";
import type { AppHostConfig } from "../../../host/AppHostConfig";
import { AppRuntimeProvider } from "../../../providers/AppRuntimeProvider";
import { usePaneSide } from "../DualPaneProvider";

interface PaneProviderProps extends PropsWithChildren {
  hostConfig: AppHostConfig;
}

export function PaneProvider({ children, hostConfig }: PaneProviderProps) {
  const side = usePaneSide();
  const { disableLocalIdentityPersistence, localIdentityNamespace } =
    hostConfig;
  const paneLocalIdentityNamespace = disableLocalIdentityPersistence
    ? undefined
    : `${localIdentityNamespace ?? "tearleads.pane"}.${side}`;
  const paneHostConfig = useMemo(
    () =>
      hostConfig.withOverrides({
        localIdentityNamespace: paneLocalIdentityNamespace,
      }),
    [hostConfig, paneLocalIdentityNamespace],
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
