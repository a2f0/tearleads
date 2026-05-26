import { CONTACTS_CONTAINER_BUILTIN_KIND } from "@tearleads/validators/containerBuiltin";
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
const CONTACTS_CONTAINER_NAME = "Contacts";

export function ContactsProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const appData = useTearleadsRuntime();
  const containerContentsRuntime = useMemo(
    () => tearleads.containerContents.runtime(),
    [appData, tearleads],
  );
  const containerContentsStore = useMemo(
    () => tearleads.containerContents.store({ logLabel: "Contacts" }),
    [containerContentsRuntime.state.domainScope, tearleads],
  );
  const containerContentsSnapshot = useTearleadsExternalStoreSnapshot(
    containerContentsStore,
  );
  const contactsContainerId = useMemo(() => {
    return (
      containerContentsSnapshot.nodes.find(
        (node) => node.builtinKind === CONTACTS_CONTAINER_BUILTIN_KIND,
      )?.id ?? null
    );
  }, [containerContentsSnapshot.nodes]);
  const documentsRuntime = useMemo(
    () => tearleads.documents.runtime(contactsContainerId),
    [appData, contactsContainerId, tearleads],
  );
  const runtime = useMemo<ContactsRuntime>(
    () => ({
      deleteLocalDocument: (localId) =>
        tearleads.documents.deleteLocalDocument(localId),
      documents: documentsRuntime,
      primeDocumentStore: (input) =>
        tearleads.documents.primeStore(input, documentsRuntime),
    }),
    [documentsRuntime, tearleads],
  );
  const store = useMemo(
    () =>
      getOrCreateContactsStore(runtime.documents.state.domainScope, runtime, {
        fetchUserKey: (userId) => tearleads.userKeys.fetch(userId),
        logError: tearleads.logError,
      }),
    [runtime, tearleads],
  );

  useEffect(() => {
    containerContentsStore.updateRuntime(containerContentsRuntime);
  }, [containerContentsRuntime, containerContentsStore]);

  useEffect(() => {
    if (!containerContentsSnapshot.ready || contactsContainerId !== null) {
      return;
    }

    void containerContentsStore.ensureBuiltinContainer(
      CONTACTS_CONTAINER_BUILTIN_KIND,
      CONTACTS_CONTAINER_NAME,
    );
  }, [
    contactsContainerId,
    containerContentsSnapshot.ready,
    containerContentsStore,
  ]);

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
