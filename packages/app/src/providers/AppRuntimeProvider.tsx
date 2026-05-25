import type { PropsWithChildren } from "react";
import type { AppHostConfig } from "../host/AppHostConfig";
import { CryptoSessionProvider } from "./crypto/CryptoSessionProvider";
import { DatabaseProvider } from "./db/DatabaseProvider";
import { AppHostConfigProvider } from "./host/AppHostConfigProvider";
import { IdentityProvider } from "./identity/IdentityProvider";
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
      <LogProvider>
        <TearleadsProvider>
          <IdentityProvider>
            <DatabaseProvider>
              <CryptoSessionProvider>{children}</CryptoSessionProvider>
            </DatabaseProvider>
          </IdentityProvider>
        </TearleadsProvider>
      </LogProvider>
    </AppHostConfigProvider>
  );
}
