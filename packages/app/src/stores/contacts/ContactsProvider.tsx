import {
  type ContactsRuntime,
  type ContactsStore,
  createContactsStore,
  getOrCreateContactsStore,
} from "@tearleads/client-sdk/stores/contacts";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useAppData } from "../../providers/data/AppDataProvider";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import type { ContactsContextValue } from "./types";

export type { ContactsRuntime };
export { createContactsStore };

const ContactsContext = createContext<ContactsStore | null>(null);

export function ContactsProvider({ children }: PropsWithChildren) {
  const appData = useAppData();
  const tearleads = useTearleads();
  const runtime = useMemo<ContactsRuntime>(
    () => tearleads.contacts.runtime(),
    [appData, tearleads],
  );
  const store = useMemo(
    () => getOrCreateContactsStore(runtime.domainScope, runtime),
    [runtime.domainScope],
  );

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  return (
    <ContactsContext.Provider value={store}>
      {children}
    </ContactsContext.Provider>
  );
}

export function useContacts(): ContactsContextValue {
  const store = useContext(ContactsContext);
  if (!store) {
    throw new Error("useContacts must be used within a ContactsProvider.");
  }

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  return useMemo(
    () => ({
      createContact: store.createContact,
      entries: snapshot.entries,
      importKey: store.importKey,
      ready: snapshot.ready,
      removeContact: store.removeContact,
      updateContact: store.updateContact,
    }),
    [snapshot, store],
  );
}
