import type { PropsWithChildren } from "react";
import { ApiClientProvider } from "../../api/ApiClientProvider";
import { NetworkStateProvider } from "../../api/NetworkStateProvider";
import { CryptoSessionProvider } from "../../crypto/CryptoSessionProvider";
import { AppDataProvider } from "../../data/AppDataProvider";
import { BlobProvider } from "../../data/blobs";
import { DatabaseProvider } from "../../db/DatabaseProvider";
import { EventsProvider } from "../../events/EventsProvider";
import type { AppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../../host/AppHostConfigProvider";
import { IdentityProvider } from "../../identity/IdentityProvider";
import { LogProvider } from "../../logging/LogProvider";

interface PaneProviderProps extends PropsWithChildren {
  hostConfig: AppHostConfig;
}

export function PaneProvider({ children, hostConfig }: PaneProviderProps) {
  return (
    <AppHostConfigProvider value={hostConfig}>
      <LogProvider>
        <ApiClientProvider>
          <NetworkStateProvider>
            <IdentityProvider>
              <BlobProvider>
                <DatabaseProvider>
                  <CryptoSessionProvider>
                    <EventsProvider>
                      <AppDataProvider>{children}</AppDataProvider>
                    </EventsProvider>
                  </CryptoSessionProvider>
                </DatabaseProvider>
              </BlobProvider>
            </IdentityProvider>
          </NetworkStateProvider>
        </ApiClientProvider>
      </LogProvider>
    </AppHostConfigProvider>
  );
}
