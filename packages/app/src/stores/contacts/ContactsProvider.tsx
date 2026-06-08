import { deriveContainerSystemSlot } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../../providers/sdk/useTearleadsSubscription";
import {
  CONTACTS_CONTAINER_NAME,
  CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION,
} from "../systemContainers";
import type { ContactsStore } from "./contactStore";
import type { ContactsContextValue } from "./types";
import { useContactsStoreForContainer } from "./useContactsStoreForContainer";

const ContactsContext = createContext<ContactsStore | null>(null);

interface ContactsContainerEnsurer {
  ensureSystemContainer: (
    systemSlot: ContainerSystemSlot,
    name: string,
  ) => Promise<unknown>;
}

function useContactsSystemSlot(input: {
  logError: (message: string | Error, cause?: unknown) => void;
  signingPrivateKey: Uint8Array | null;
}): ContainerSystemSlot | null {
  const [contactsSystemSlot, setContactsSystemSlot] =
    useState<ContainerSystemSlot | null>(null);

  useEffect(() => {
    if (!input.signingPrivateKey) {
      setContactsSystemSlot(null);
      return;
    }

    let cancelled = false;
    void deriveContainerSystemSlot({
      definition: CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION,
      secretKey: input.signingPrivateKey,
    })
      .then((systemSlot) => {
        if (!cancelled) {
          setContactsSystemSlot(systemSlot);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setContactsSystemSlot(null);
          input.logError("Failed to derive contacts system slot", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [input.logError, input.signingPrivateKey]);

  return contactsSystemSlot;
}

function useEnsureContactsContainer(input: {
  contactsContainerId: string | null;
  contactsSystemSlot: ContainerSystemSlot | null;
  containerContentsReady: boolean;
  containerContentsStore: ContactsContainerEnsurer;
  logError: (message: string | Error, cause?: unknown) => void;
}): void {
  useEffect(() => {
    if (
      !input.contactsSystemSlot ||
      !input.containerContentsReady ||
      input.contactsContainerId !== null
    ) {
      return;
    }

    void input.containerContentsStore
      .ensureSystemContainer(input.contactsSystemSlot, CONTACTS_CONTAINER_NAME)
      .catch((error) => {
        input.logError("Failed to ensure system contacts container", error);
      });
  }, [
    input.contactsContainerId,
    input.contactsSystemSlot,
    input.containerContentsReady,
    input.containerContentsStore,
    input.logError,
  ]);
}

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
    if (!contactsSystemSlot) {
      return null;
    }

    return (
      containerContentsSnapshot.nodes.find(
        (node) => node.systemSlot === contactsSystemSlot,
      )?.id ?? null
    );
  }, [contactsSystemSlot, containerContentsSnapshot.nodes]);
  const store = useContactsStoreForContainer(contactsContainerId);

  useEffect(() => {
    if (!hasRootContainerId) {
      return;
    }

    containerContentsStore.updateRuntime(containerContentsRuntime);
  }, [containerContentsRuntime, containerContentsStore, hasRootContainerId]);

  useEnsureContactsContainer({
    contactsContainerId,
    contactsSystemSlot,
    containerContentsReady:
      hasRootContainerId && containerContentsSnapshot.ready,
    containerContentsStore,
    logError: tearleads.logError,
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
