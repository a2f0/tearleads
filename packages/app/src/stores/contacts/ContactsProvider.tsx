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
import {
  type ContactsRuntime,
  type ContactsStore,
  getOrCreateContactsStore,
} from "./contactStore";
import type { ContactsContextValue } from "./types";

const ContactsContext = createContext<ContactsStore | null>(null);

export function ContactsProvider({ children }: PropsWithChildren) {
  const appData = useAppData();
  const tearleads = useTearleads();
  const runtime = useMemo<ContactsRuntime>(
    () => ({
      documents: tearleads.documents.runtime(),
      execSql: appData.execSql,
    }),
    [appData, tearleads],
  );
  const store = useMemo(
    () =>
      getOrCreateContactsStore(runtime.documents.domainScope, runtime, {
        fetchUserKey: (userId) => tearleads.userKeys.fetch(userId),
        logError: tearleads.logError,
      }),
    [runtime, tearleads],
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
