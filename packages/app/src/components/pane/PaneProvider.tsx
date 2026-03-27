import type { PropsWithChildren } from "react";
import { ApiClientProvider } from "../../api/ApiClientProvider";
import { NetworkStateProvider } from "../../api/NetworkStateProvider";
import { AddressBookProvider } from "../../crypto/AddressBookProvider";
import { CryptoSessionProvider } from "../../crypto/CryptoSessionProvider";
import {
  type DatabaseContextValue,
  DatabaseProvider,
} from "../../db/DatabaseProvider";
import { EventsProvider } from "../../events/EventsProvider";
import type { AppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../../host/AppHostConfigProvider";
import { LogProvider } from "../../logging/LogProvider";

export type { DatabaseContextValue };

interface PaneProviderProps extends PropsWithChildren {
  hostConfig: AppHostConfig;
}

export function PaneProvider({ children, hostConfig }: PaneProviderProps) {
  return (
    <AppHostConfigProvider value={hostConfig}>
      <LogProvider>
        <ApiClientProvider>
          <NetworkStateProvider>
            <DatabaseProvider>
              <CryptoSessionProvider>
                <AddressBookProvider>
                  <EventsProvider>{children}</EventsProvider>
                </AddressBookProvider>
              </CryptoSessionProvider>
            </DatabaseProvider>
          </NetworkStateProvider>
        </ApiClientProvider>
      </LogProvider>
    </AppHostConfigProvider>
  );
}
