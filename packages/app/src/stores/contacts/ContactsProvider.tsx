import type {
  ContainerContentsStore,
  ContainerNode,
  DocumentSummary,
  Tearleads,
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

function useContactsOrganizationPolicy(input: {
  appData: RuntimeSnapshot;
  nodeCount: number;
  tearleads: Tearleads;
}) {
  const primaryLocalOrganization = usePrimaryLocalOrganization({
    defaultOrganizationId: input.appData.auth.defaultOrganizationId,
    enabled:
      input.appData.auth.isAuthenticated &&
      input.appData.infra.dbStatus === "ready",
    refreshKey: [
      input.appData.auth.organizationId ?? "",
      input.appData.state.containerId ?? "",
      String(input.nodeCount),
    ].join(":"),
    tearleads: input.tearleads,
  });
  const canBootstrap =
    resolveContactsBootstrapPolicy({
      currentOrganizationId: input.appData.auth.organizationId,
      isAuthenticated: input.appData.auth.isAuthenticated,
      primaryLocalOrganization,
    }) === true;

  return { canBootstrap, primaryLocalOrganization };
}

function useContactsSystemContainerResolution(input: {
  appData: RuntimeSnapshot;
  logError: (message: string | Error, cause?: unknown) => void;
  nodes: Parameters<typeof resolveContactsContainer>[0]["nodes"];
  primaryLocalOrganization: {
    readonly organizationId: string | null;
    readonly ready: boolean;
  };
  signingPrivateKey: Uint8Array | null;
}) {
  const {
    appData,
    logError,
    nodes,
    primaryLocalOrganization,
    signingPrivateKey,
  } = input;
  const { contactsSystemSlot, trashSystemSlot } = useContactsSystemSlots({
    logError,
    signingPrivateKey,
  });
  const contactsContainer = useMemo(() => {
    // Contacts is a personal system container. Activating a custom org changes
    // the tree runtime, but the Contacts projection must stay on the default org.
    if (
      appData.auth.isAuthenticated &&
      (!primaryLocalOrganization.ready ||
        !primaryLocalOrganization.organizationId)
    ) {
      return { canWrite: false, id: null };
    }

    const organizationId = appData.auth.isAuthenticated
      ? primaryLocalOrganization.organizationId
      : appData.auth.organizationId;
    const rootContainerId = appData.auth.isAuthenticated
      ? (nodes.find(
          (node) =>
            node.parentId === null && node.organizationId === organizationId,
        )?.id ?? null)
      : appData.state.containerId;

    return resolveContactsContainer({
      nodes,
      organizationId,
      rootContainerId,
      systemSlot: contactsSystemSlot,
    });
  }, [
    appData.auth.isAuthenticated,
    appData.auth.organizationId,
    appData.state.containerId,
    contactsSystemSlot,
    nodes,
    primaryLocalOrganization.organizationId,
    primaryLocalOrganization.ready,
  ]);

  return { contactsContainer, contactsSystemSlot, trashSystemSlot };
}

// Builds the per-contact Trash resolver the store uses on removal: it resolves the
// Trash from the contact document's OWN container (org-aware) and lazily provisions
// the viewer's Trash — matching the Explorer, so removal still lands in a
// not-yet-synced / payment-lapsed organization. Nodes are read at call time (not
// closed over) so the callback identity stays stable across tree updates and a
// just-created Trash is visible.
function useContactsTrashResolver(input: {
  containerContentsStore: ContainerContentsStore;
  currentOrganizationId: string | null;
  trashSystemSlot: ContainerSystemSlot | null;
}): (document: DocumentSummary) => Promise<string | null> {
  const { containerContentsStore, currentOrganizationId, trashSystemSlot } =
    input;
  const ensureOwnTrashContainer = useCallback(
    () => ensureTrashSystemContainer(containerContentsStore, trashSystemSlot),
    [containerContentsStore, trashSystemSlot],
  );
  return useCallback(
    (document: DocumentSummary) =>
      resolveDeleteToTrashTarget({
        containerId: document.containerId,
        currentOrganizationId,
        ensureOwnTrashContainer,
        nodes: containerContentsStore.getSnapshot().nodes,
        trashSystemSlot,
      }),
    [
      containerContentsStore,
      currentOrganizationId,
      ensureOwnTrashContainer,
      trashSystemSlot,
    ],
  );
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
  const {
    canBootstrap: canBootstrapContactsContainer,
    primaryLocalOrganization,
  } = useContactsOrganizationPolicy({
    appData,
    nodeCount: containerContentsSnapshot.nodes.length,
    tearleads,
  });
  const { contactsContainer, contactsSystemSlot, trashSystemSlot } =
    useContactsSystemContainerResolution({
      appData,
      logError: tearleads.logError,
      nodes: containerContentsSnapshot.nodes,
      primaryLocalOrganization,
      signingPrivateKey:
        containerContentsRuntime.crypto.signingKeyPair?.signingPrivateKey ??
        null,
    });
  const resolveTrashContainerForDocument = useContactsTrashResolver({
    containerContentsStore,
    currentOrganizationId: appData.auth.organizationId,
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

  useEffect(() => {
    if (
      !hasRootContainerId ||
      !containerContentsRuntime.auth.isAuthenticated ||
      !canBootstrapContactsContainer ||
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
    canBootstrapContactsContainer,
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
