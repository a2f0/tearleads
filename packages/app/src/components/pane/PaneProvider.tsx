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
import { LogProvider } from "../../logging/LogProvider";
import { PersonaProvider } from "../../persona/PersonaProvider";

interface PaneProviderProps extends PropsWithChildren {
  hostConfig: AppHostConfig;
}

export function PaneProvider({ children, hostConfig }: PaneProviderProps) {
  return (
    <AppHostConfigProvider value={hostConfig}>
      <LogProvider>
        <ApiClientProvider>
          <NetworkStateProvider>
            <PersonaProvider>
              <BlobProvider>
                <DatabaseProvider>
                  <CryptoSessionProvider>
                    <EventsProvider>
                      <AppDataProvider>{children}</AppDataProvider>
                    </EventsProvider>
                  </CryptoSessionProvider>
                </DatabaseProvider>
              </BlobProvider>
            </PersonaProvider>
          </NetworkStateProvider>
        </ApiClientProvider>
      </LogProvider>
    </AppHostConfigProvider>
  );
}
