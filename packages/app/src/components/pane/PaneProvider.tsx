import type { PropsWithChildren } from "react";
import type { AppHostConfig } from "../../host/AppHostConfig";
import { ApiClientProvider } from "../../providers/api/ApiClientProvider";
import { NetworkStateProvider } from "../../providers/api/NetworkStateProvider";
import { BlobProvider } from "../../providers/blobs/BlobProvider";
import { CryptoSessionProvider } from "../../providers/crypto/CryptoSessionProvider";
import { AppDataProvider } from "../../providers/data/AppDataProvider";
import { DatabaseProvider } from "../../providers/db/DatabaseProvider";
import { EventsProvider } from "../../providers/events/EventsProvider";
import { AppHostConfigProvider } from "../../providers/host/AppHostConfigProvider";
import { IdentityProvider } from "../../providers/identity/IdentityProvider";
import { LogProvider } from "../../providers/logging/LogProvider";

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
