import type { PropsWithChildren } from "react";
import { ApiClientProvider } from "../../api/ApiClientProvider";
import { NetworkStateProvider } from "../../api/NetworkStateProvider";
import { ContactsProvider } from "../../contacts/ContactsProvider";
import { CryptoSessionProvider } from "../../crypto/CryptoSessionProvider";
import { DatabaseProvider } from "../../db/DatabaseProvider";
import { EventsProvider } from "../../events/EventsProvider";
import type { AppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../../host/AppHostConfigProvider";
import { LogProvider } from "../../logging/LogProvider";
import { NotesProvider } from "../../mini-apps/notes/NotesProvider";

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
                <ContactsProvider>
                  <EventsProvider>
                    <NotesProvider>{children}</NotesProvider>
                  </EventsProvider>
                </ContactsProvider>
              </CryptoSessionProvider>
            </DatabaseProvider>
          </NetworkStateProvider>
        </ApiClientProvider>
      </LogProvider>
    </AppHostConfigProvider>
  );
}
