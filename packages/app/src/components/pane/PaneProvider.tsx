import type { PropsWithChildren } from "react";
import type { AppHostConfig } from "../../host/AppHostConfig";
import { CryptoSessionProvider } from "../../providers/crypto/CryptoSessionProvider";
import { AppDataProvider } from "../../providers/data/AppDataProvider";
import { DatabaseProvider } from "../../providers/db/DatabaseProvider";
import { EventsProvider } from "../../providers/events/EventsProvider";
import { AppHostConfigProvider } from "../../providers/host/AppHostConfigProvider";
import { IdentityProvider } from "../../providers/identity/IdentityProvider";
import { LogProvider } from "../../providers/logging/LogProvider";
import { TearleadsProvider } from "../../providers/sdk/TearleadsProvider";

interface PaneProviderProps extends PropsWithChildren {
  hostConfig: AppHostConfig;
}

export function PaneProvider({ children, hostConfig }: PaneProviderProps) {
  return (
    <AppHostConfigProvider value={hostConfig}>
      <LogProvider>
        <TearleadsProvider>
          <IdentityProvider>
            <DatabaseProvider>
              <CryptoSessionProvider>
                <EventsProvider>
                  <AppDataProvider>{children}</AppDataProvider>
                </EventsProvider>
              </CryptoSessionProvider>
            </DatabaseProvider>
          </IdentityProvider>
        </TearleadsProvider>
      </LogProvider>
    </AppHostConfigProvider>
  );
}
