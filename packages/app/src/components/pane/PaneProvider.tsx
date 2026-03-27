import type { PropsWithChildren } from "react";
import { ApiClientProvider } from "../../api/ApiClientProvider";
import { NetworkStateProvider } from "../../api/NetworkStateProvider";
import { AddressBookProvider } from "../../crypto/AddressBookProvider";
import { CryptoSessionProvider } from "../../crypto/CryptoSessionProvider";
import {
  type DatabaseContextValue,
  DatabaseProvider,
} from "../../db/DatabaseProvider";
import type { createAppDatabaseWorker } from "../../db/sqliteWorker";
import { EventsProvider } from "../../events/EventsProvider";
import type { AppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../../host/AppHostConfigProvider";
import { LogProvider } from "../../logging/LogProvider";

export type { DatabaseContextValue };

interface PaneProviderProps extends PropsWithChildren {
  createWorker: typeof createAppDatabaseWorker;
  hostConfig: AppHostConfig;
}

export function PaneProvider({
  children,
  createWorker,
  hostConfig,
}: PaneProviderProps) {
  return (
    <AppHostConfigProvider value={hostConfig}>
      <LogProvider>
        <ApiClientProvider>
          <NetworkStateProvider>
            <DatabaseProvider createWorker={createWorker}>
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
