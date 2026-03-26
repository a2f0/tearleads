import type { PropsWithChildren } from "react";
import { AddressBookProvider } from "../../crypto/AddressBookProvider";
import { CryptoSessionProvider } from "../../crypto/CryptoSessionProvider";
import {
  type DatabaseContextValue,
  DatabaseProvider,
} from "../../db/DatabaseProvider";
import type { createAppDatabaseWorker } from "../../db/sqliteWorker";
import { EventsProvider } from "../../events/EventsProvider";
import { LogProvider } from "../../logging/LogProvider";

export type { DatabaseContextValue };

interface PaneProviderProps extends PropsWithChildren {
  createWorker: typeof createAppDatabaseWorker;
}

export function PaneProvider({ children, createWorker }: PaneProviderProps) {
  return (
    <LogProvider>
      <DatabaseProvider createWorker={createWorker}>
        <CryptoSessionProvider>
          <AddressBookProvider>
            <EventsProvider>{children}</EventsProvider>
          </AddressBookProvider>
        </CryptoSessionProvider>
      </DatabaseProvider>
    </LogProvider>
  );
}
