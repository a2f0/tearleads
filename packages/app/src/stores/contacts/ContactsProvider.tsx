import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
} from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../../providers/sdk/useTearleadsSubscription";
import {
  type ContactsRuntime,
  type ContactsStore,
  getOrCreateContactsStore,
} from "./contactStore";
import type { ContactsContextValue } from "./types";

const ContactsContext = createContext<ContactsStore | null>(null);

export function ContactsProvider({ children }: PropsWithChildren) {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const runtime = useMemo<ContactsRuntime>(
    () => ({
      deleteLocalDocument: (localId) =>
        tearleads.documents.deleteLocalDocument(localId),
      documents: tearleads.documents.runtime(null),
      execSql: appData.execSql,
      primeDocumentStore: (input) => tearleads.documents.primeStore(input),
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

  const snapshot = useTearleadsExternalStoreSnapshot(store);

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
