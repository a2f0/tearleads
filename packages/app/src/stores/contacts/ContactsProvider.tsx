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
import { useContainerContentsDeviceFirst } from "../device-first/useContainerContentsDeviceFirst";
import type { ContactsStore } from "./contactStore";
import type { ContactsContextValue } from "./types";
import {
  getContactsContainerId,
  useContactsCriticalNodesBootstrap,
  useContactsSystemSlot,
} from "./useContactsCriticalNodesBootstrap";
import { useContactsStoreForContainer } from "./useContactsStoreForContainer";

interface ContactsProviderContextValue {
  canWrite: boolean;
  store: ContactsStore;
}

const ContactsContext = createContext<ContactsProviderContextValue | null>(
  null,
);

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
  // Device-first seam: instant local tree reads plus the background reconciler,
  // which routes server events instead of any render-driven discovery effect.
  // The store (above) is still used for tree reads + system-container mutations.
  useContainerContentsDeviceFirst({
    events: appData.state.events,
    logLabel: "Contacts",
    runtime: containerContentsRuntime,
  });
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
  const contactsContainer = useMemo(
    () =>
      contactsContainerId
        ? (containerContentsSnapshot.nodes.find(
            (node) => node.id === contactsContainerId,
          ) ?? null)
        : null,
    [contactsContainerId, containerContentsSnapshot.nodes],
  );
  const canWrite = Boolean(
    contactsContainer && contactsContainer.effectiveAccessLevel !== "read",
  );
  const store = useContactsStoreForContainer(contactsContainerId);
  const contextValue = useMemo<ContactsProviderContextValue>(
    () => ({ canWrite, store }),
    [canWrite, store],
  );

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
    deferRemoteBootstrap: true,
  });

  return (
    <ContactsContext.Provider value={contextValue}>
      {children}
    </ContactsContext.Provider>
  );
}

export function useContacts(): ContactsContextValue {
  const contextValue = useContext(ContactsContext);
  if (!contextValue) {
    throw new Error("useContacts must be used within a ContactsProvider.");
  }
  const { canWrite, store } = contextValue;

  const snapshot = useTearleadsExternalStoreSnapshot(store);

  return useMemo(
    () => ({
      canWrite,
      createContact: store.createContact,
      entries: snapshot.entries,
      importKey: store.importKey,
      ready: snapshot.ready,
      removeContact: store.removeContact,
      updateContact: store.updateContact,
    }),
    [canWrite, snapshot, store],
  );
}
