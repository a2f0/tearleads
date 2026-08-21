import type { PropsWithChildren } from "react";
import { useMemo } from "react";
import type { AppHostConfig } from "../../../host/AppHostConfig";
import { AppRuntimeProvider } from "../../../providers/AppRuntimeProvider";
import { usePaneSide } from "../dual-pane";

interface PaneProviderProps extends PropsWithChildren {
  hostConfig: AppHostConfig;
  /** Forwarded to the runtime's identity autopilot; see AppRuntimeProvider. */
  autoProvisionEnabled?: boolean | undefined;
}

export function PaneProvider({
  autoProvisionEnabled,
  children,
  hostConfig,
}: PaneProviderProps) {
  const side = usePaneSide();
  const { disableLocalIdentityPersistence, localIdentityNamespace } =
    hostConfig;
  const paneLocalIdentityNamespace = disableLocalIdentityPersistence
    ? undefined
    : `${localIdentityNamespace ?? "symcrypt.pane"}.${side}`;
  const paneHostConfig = useMemo(
    () =>
      hostConfig.withOverrides({
        localIdentityNamespace: paneLocalIdentityNamespace,
      }),
    [hostConfig, paneLocalIdentityNamespace],
  );

  return (
    <AppRuntimeProvider
      autoProvisionEnabled={autoProvisionEnabled}
      hostConfig={paneHostConfig}
    >
      {children}
    </AppRuntimeProvider>
  );
}
