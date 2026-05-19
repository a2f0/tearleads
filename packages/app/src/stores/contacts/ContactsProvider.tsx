import { createContactsWorkflowRuntime } from "@tearleads/client-sdk/workflows/contacts/index";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useAppData } from "../../providers/data/AppDataProvider";
import { getOrCreateContactsStore } from "./contactStore";
import type {
  ContactsContextValue,
  ContactsRuntime,
  ContactsStore,
} from "./types";

export { createContactsStore } from "./contactStore";
export type { ContactsRuntime } from "./types";

const ContactsContext = createContext<ContactsStore | null>(null);

export function ContactsProvider({ children }: PropsWithChildren) {
  const appData = useAppData();
  const runtime = useMemo<ContactsRuntime>(
    () => createContactsWorkflowRuntime(appData),
    [appData],
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
