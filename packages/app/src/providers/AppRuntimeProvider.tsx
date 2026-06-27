import type { PropsWithChildren } from "react";
import type { AppHostConfig } from "../host/AppHostConfig";
import { IdentityAutopilot } from "../identity/IdentityAutopilot";
import { CryptoSessionProvider } from "./crypto/CryptoSessionProvider";
import { DatabaseProvider } from "./db/DatabaseProvider";
import { AppHostConfigProvider } from "./host/AppHostConfigProvider";
import { IdentityProvider } from "./identity/IdentityProvider";
import { LocalKeyringLockProvider } from "./local-keyring/LocalKeyringLockProvider";
import { LogProvider } from "./logging/LogProvider";
import { TearleadsProvider } from "./sdk/TearleadsProvider";

interface AppRuntimeProviderProps extends PropsWithChildren {
  hostConfig: AppHostConfig;
  /**
   * Whether this runtime's identity autopilot may auto-provision. Defaults to
   * true; the workspace layer passes the workspace's active state so concurrently
   * mounted but inactive workspaces do not provision a second identity.
   */
  autoProvisionEnabled?: boolean | undefined;
}

export function AppRuntimeProvider({
  autoProvisionEnabled = true,
  children,
  hostConfig,
}: AppRuntimeProviderProps) {
  return (
    <AppHostConfigProvider value={hostConfig}>
      <LocalKeyringLockProvider>
        <LogProvider>
          <TearleadsProvider>
            <DatabaseProvider>
              <IdentityProvider>
                <CryptoSessionProvider>
                  <IdentityAutopilot enabled={autoProvisionEnabled} />
                  {children}
                </CryptoSessionProvider>
              </IdentityProvider>
            </DatabaseProvider>
          </TearleadsProvider>
        </LogProvider>
      </LocalKeyringLockProvider>
    </AppHostConfigProvider>
  );
}
