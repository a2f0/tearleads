import type { PropsWithChildren } from "react";
import type { AppHostConfig } from "../host/AppHostConfig";
import { CryptoSessionProvider } from "./crypto/CryptoSessionProvider";
import { DatabaseProvider } from "./db/DatabaseProvider";
import { AppHostConfigProvider } from "./host/AppHostConfigProvider";
import { IdentityProvider } from "./identity/IdentityProvider";
import { LocalKeyringLockProvider } from "./local-keyring/LocalKeyringLockProvider";
import { LogProvider } from "./logging/LogProvider";
import { TearleadsProvider } from "./sdk/TearleadsProvider";

interface AppRuntimeProviderProps extends PropsWithChildren {
  hostConfig: AppHostConfig;
}

export function AppRuntimeProvider({
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
                <CryptoSessionProvider>{children}</CryptoSessionProvider>
              </IdentityProvider>
            </DatabaseProvider>
          </TearleadsProvider>
        </LogProvider>
      </LocalKeyringLockProvider>
    </AppHostConfigProvider>
  );
}
