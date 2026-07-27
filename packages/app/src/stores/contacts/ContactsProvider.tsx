import type {
  ContainerContentsStore,
  ContainerNode,
  DocumentSummary,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "react";
import {
  type RuntimeSnapshot,
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import {
  resolveContactsBootstrapPolicy,
  usePrimaryLocalOrganization,
} from "../../providers/sdk/usePrimaryLocalOrganization";
import { useTearleadsExternalStoreSnapshot } from "../../providers/sdk/useTearleadsSubscription";
import { CONTACTS_CONTAINER_NAME } from "../systemContainers";
import {
  ensureTrashSystemContainer,
  resolveDeleteToTrashTarget,
} from "../systemContainerTrash";
import type { ContactsStore } from "./contactStore";
import {
  getContactsContainerId,
  resolveContactsProjectionRootContainerId,
  useContactsSystemSlots,
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
}): {
  canWrite: boolean;
  id: string | null;
  organizationId: string | null;
  rootContainerId: string | null;
} {
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
    organizationId: input.organizationId ?? null,
    rootContainerId: input.rootContainerId ?? null,
  };
}

function useContactsOrganizationPolicy(input: { appData: RuntimeSnapshot }) {
  const primaryLocalOrganization = usePrimaryLocalOrganization({
    defaultOrganizationId: input.appData.auth.defaultOrganizationId,
    enabled:
      input.appData.auth.isAuthenticated &&
      input.appData.infra.dbStatus === "ready",
  });
  return (
    resolveContactsBootstrapPolicy({
      currentOrganizationId: input.appData.auth.organizationId,
      isAuthenticated: input.appData.auth.isAuthenticated,
      primaryLocalOrganization,
    }) === true
  );
}

function useContactsSystemContainerResolution(input: {
  appData: RuntimeSnapshot;
  logError: (message: string | Error, cause?: unknown) => void;
  nodes: Parameters<typeof resolveContactsContainer>[0]["nodes"];
  signingPrivateKey: Uint8Array | null;
}) {
  const { appData, logError, nodes, signingPrivateKey } = input;
  const { contactsSystemSlot, trashSystemSlot } = useContactsSystemSlots({
    logError,
    signingPrivateKey,
  });
  const contactsContainer = useMemo(() => {
    // Contacts is a personal system container. Activating a custom org changes
    // the tree runtime, but the Contacts projection must stay on the
    // authoritative default org.
    const organizationId = appData.auth.isAuthenticated
      ? (appData.auth.defaultOrganizationId ?? null)
      : appData.auth.organizationId;
    if (appData.auth.isAuthenticated && !organizationId) {
      return {
        canWrite: false,
        id: null,
        organizationId: null,
        rootContainerId: null,
      };
    }

    const rootContainerId = appData.auth.isAuthenticated
      ? resolveContactsProjectionRootContainerId({
          activeOrganizationId: appData.auth.organizationId,
          activeRootContainerId: appData.state.containerId,
          nodes,
          projectionOrganizationId: organizationId,
        })
      : appData.state.containerId;

    return resolveContactsContainer({
      nodes,
      organizationId,
      rootContainerId,
      systemSlot: contactsSystemSlot,
    });
  }, [
    appData.auth.isAuthenticated,
    appData.auth.defaultOrganizationId,
    appData.auth.organizationId,
    appData.state.containerId,
    contactsSystemSlot,
    nodes,
  ]);

  return { contactsContainer, contactsSystemSlot, trashSystemSlot };
}

// Builds the per-contact Trash resolver the store uses on removal. Contacts stays
// projected onto the personal org when a custom org is active, so Trash resolution
// must use that same logical org. Lazy creation is safe only when the personal root
// is also the active runtime root: ensureSystemContainer is active-root scoped.
// Nodes are read at call time so a just-created Trash is visible.
function useContactsTrashResolver(input: {
  activeRootContainerId: string | null;
  containerContentsStore: ContainerContentsStore;
  contactsOrganizationId: string | null;
  contactsRootContainerId: string | null;
  trashSystemSlot: ContainerSystemSlot | null;
}): (document: DocumentSummary) => Promise<string | null> {
  const {
    activeRootContainerId,
    containerContentsStore,
    contactsOrganizationId,
    contactsRootContainerId,
    trashSystemSlot,
  } = input;
  const ensureOwnTrashContainer = useCallback(() => {
    if (
      !contactsRootContainerId ||
      activeRootContainerId !== contactsRootContainerId
    ) {
      // ensureSystemContainer would target the active custom root. Fail closed
      // until personal Trash is visible or the personal root becomes active.
      return Promise.resolve(null);
    }

    return ensureTrashSystemContainer(containerContentsStore, trashSystemSlot);
  }, [
    activeRootContainerId,
    contactsRootContainerId,
    containerContentsStore,
    trashSystemSlot,
  ]);
  return useCallback(
    (document: DocumentSummary) =>
      resolveDeleteToTrashTarget({
        containerId: document.containerId,
        currentOrganizationId: contactsOrganizationId,
        ensureOwnTrashContainer,
        nodes: containerContentsStore.getSnapshot().nodes,
        trashSystemSlot,
      }),
    [
      containerContentsStore,
      contactsOrganizationId,
      ensureOwnTrashContainer,
      trashSystemSlot,
    ],
  );
}

function useContactsSystemContainerBootstrap(input: {
  canBootstrap: boolean;
  contactsSystemSlot: ContainerSystemSlot | null;
  hasRootContainerId: boolean;
  isAuthenticated: boolean;
  logError: (message: string | Error, cause?: unknown) => void;
  ready: boolean;
  store: ContainerContentsStore;
}) {
  const {
    canBootstrap,
    contactsSystemSlot,
    hasRootContainerId,
    isAuthenticated,
    logError,
    ready,
    store,
  } = input;
  useEffect(() => {
    if (
      !hasRootContainerId ||
      !isAuthenticated ||
      !canBootstrap ||
      !ready ||
      !contactsSystemSlot
    ) {
      return;
    }

    void store
      .ensureSystemContainer(contactsSystemSlot, CONTACTS_CONTAINER_NAME, {
        deferRemoteBootstrap: true,
        skipAdvancedManagedRoot: true,
      })
      .catch((error: unknown) => {
        logError("Failed to queue contacts system container", error);
      });
  }, [
    canBootstrap,
    contactsSystemSlot,
    hasRootContainerId,
    isAuthenticated,
    logError,
    ready,
    store,
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
  const canBootstrapContactsContainer = useContactsOrganizationPolicy({
    appData,
  });
  const { contactsContainer, contactsSystemSlot, trashSystemSlot } =
    useContactsSystemContainerResolution({
      appData,
      logError: tearleads.logError,
      nodes: containerContentsSnapshot.nodes,
      signingPrivateKey:
        containerContentsRuntime.crypto.signingKeyPair?.signingPrivateKey ??
        null,
    });
  // Contacts stays projected on the default org while a custom org is active,
  // so the org equality keeps bootstrap from creating another Contacts folder
  // under the custom root.
  const canBootstrapActiveContactsContainer = Boolean(
    canBootstrapContactsContainer &&
      (!appData.auth.isAuthenticated ||
        contactsContainer.organizationId === appData.auth.organizationId),
  );
  const resolveTrashContainerForDocument = useContactsTrashResolver({
    activeRootContainerId: containerContentsRuntime.state.containerId,
    containerContentsStore,
    contactsOrganizationId: contactsContainer.organizationId,
    contactsRootContainerId: contactsContainer.rootContainerId,
    trashSystemSlot,
  });
  const store = useContactsStoreForContainer(
    contactsContainer.id,
    resolveTrashContainerForDocument,
  );
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
  useContactsSystemContainerBootstrap({
    canBootstrap: canBootstrapActiveContactsContainer,
    contactsSystemSlot,
    hasRootContainerId,
    isAuthenticated: containerContentsRuntime.auth.isAuthenticated,
    logError: tearleads.logError,
    ready: containerContentsSnapshot.ready,
    store: containerContentsStore,
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
      removeContactAvatar: store.removeContactAvatar,
      setContactAvatar: store.setContactAvatar,
      updateContact: store.updateContact,
    }),
    [canWrite, snapshot, store],
  );
}
