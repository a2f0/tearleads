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
import type { ContactsStore } from "./contactStore";
import type { ContactsContextValue } from "./types";
import {
  getContactsContainerId,
  useContactsCriticalNodesBootstrap,
  useContactsSystemSlot,
} from "./useContactsCriticalNodesBootstrap";
import { useContactsStoreForContainer } from "./useContactsStoreForContainer";

const ContactsContext = createContext<ContactsStore | null>(null);

export function ContactsProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const appData = useTearleadsRuntime();
  const containerContentsRuntime = useMemo(
    () => tearleads.containerContents.workflowRuntime(),
    [appData, tearleads],
  );
  const hasRootContainerId = Boolean(
    containerContentsRuntime.state.containerId,
  );
  const containerContentsStore = useMemo(
    () => tearleads.containerContents.openTree({ logLabel: "Contacts" }),
    [containerContentsRuntime.state.domainScope, tearleads],
  );
  const containerContentsSnapshot = useTearleadsExternalStoreSnapshot(
    containerContentsStore,
  );
  const contactsSystemSlot = useContactsSystemSlot({
    logError: tearleads.logError,
    signingPrivateKey:
      containerContentsRuntime.crypto.signingKeyPair?.signingPrivateKey ?? null,
  });
  const contactsContainerId = useMemo(() => {
    return getContactsContainerId(
      containerContentsSnapshot.nodes,
      contactsSystemSlot,
    );
  }, [contactsSystemSlot, containerContentsSnapshot.nodes]);
  const store = useContactsStoreForContainer(contactsContainerId);

  useEffect(() => {
    if (!hasRootContainerId) {
      return;
    }

    containerContentsStore.updateRuntime(containerContentsRuntime);
  }, [containerContentsRuntime, containerContentsStore, hasRootContainerId]);

  useContactsCriticalNodesBootstrap({
    contactsContainerId,
    contactsStore: store,
    contactsSystemSlot,
    containerContentsReady:
      hasRootContainerId && containerContentsSnapshot.ready,
    containerContentsStore,
  });

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
