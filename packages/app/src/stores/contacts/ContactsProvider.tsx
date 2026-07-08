import type { ContainerNode } from "@tearleads/client-sdk";
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
import { CONTACTS_CONTAINER_NAME } from "../systemContainers";
import type { ContactsStore } from "./contactStore";
import {
  getContactsContainerId,
  useContactsSystemSlot,
} from "./contactsSystemSlot";
import type { ContactsContextValue } from "./types";
import { useContactsStoreForContainer } from "./useContactsStoreForContainer";

interface ContactsProviderContextValue {
  canWrite: boolean;
  store: ContactsStore;
}

const ContactsContext = createContext<ContactsProviderContextValue | null>(
  null,
);

function resolveContactsContainer(input: {
  nodes: ReadonlyArray<
    Pick<
      ContainerNode,
      | "effectiveAccessLevel"
      | "id"
      | "organizationId"
      | "parentId"
      | "systemSlot"
    >
  >;
  organizationId: string | null | undefined;
  rootContainerId: string | null | undefined;
  systemSlot: Parameters<typeof getContactsContainerId>[1];
}): { canWrite: boolean; id: string | null } {
  const id = getContactsContainerId(
    input.nodes,
    input.systemSlot,
    input.organizationId,
    input.rootContainerId,
  );
  const container = id
    ? (input.nodes.find((node) => node.id === id) ?? null)
    : null;
  return {
    canWrite: Boolean(container && container.effectiveAccessLevel !== "read"),
    id,
  };
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
  const contactsContainer = useMemo(
    () =>
      resolveContactsContainer({
        nodes: containerContentsSnapshot.nodes,
        organizationId: appData.auth.organizationId,
        rootContainerId: appData.state.containerId,
        systemSlot: contactsSystemSlot,
      }),
    [
      appData.auth.organizationId,
      appData.state.containerId,
      contactsSystemSlot,
      containerContentsSnapshot.nodes,
    ],
  );
  const store = useContactsStoreForContainer(contactsContainer.id);
  const contextValue = useMemo<ContactsProviderContextValue>(
    () => ({ canWrite: contactsContainer.canWrite, store }),
    [contactsContainer.canWrite, store],
  );

  useEffect(() => {
    if (!hasRootContainerId) {
      return;
    }

    containerContentsStore.updateRuntime(containerContentsRuntime);
  }, [containerContentsRuntime, containerContentsStore, hasRootContainerId]);

  useEffect(() => {
    if (
      !hasRootContainerId ||
      !containerContentsRuntime.auth.isAuthenticated ||
      !containerContentsSnapshot.ready ||
      !contactsSystemSlot
    ) {
      return;
    }

    void containerContentsStore
      .ensureSystemContainer(contactsSystemSlot, CONTACTS_CONTAINER_NAME, {
        deferRemoteBootstrap: true,
        skipAdvancedManagedRoot: true,
      })
      .catch((error: unknown) => {
        tearleads.logError("Failed to queue contacts system container", error);
      });
  }, [
    contactsSystemSlot,
    containerContentsRuntime.auth.isAuthenticated,
    containerContentsSnapshot.ready,
    containerContentsStore,
    hasRootContainerId,
    tearleads.logError,
  ]);

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
