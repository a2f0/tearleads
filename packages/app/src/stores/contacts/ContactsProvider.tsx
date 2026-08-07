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
  defineFacadeKeys,
  projectFacade,
} from "../../providers/sdk/projectFacade";
import {
  type RuntimeSnapshot,
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import {
  resolveContactsBootstrapPolicy,
  usePrimaryLocalOrganization,
} from "../../providers/sdk/usePrimaryLocalOrganization";
import { useRuntimeScopedMemo } from "../../providers/sdk/useRuntimeScopedMemo";
import { useTearleadsExternalStoreSnapshot } from "../../providers/sdk/useTearleadsSubscription";
import { useUserSystemContainers } from "../../providers/system-bootstrap/UserSystemContainersProvider";
import { useDeviceFirstContainerContents } from "../device-first/DeviceFirstProvider";
import { getExplorerSystemContainerId } from "../explorer/ExplorerSystemContainers";
import {
  CONTACTS_CONTAINER_NAME,
  findUserSystemContainer,
} from "../systemContainers";
import {
  ensureTrashSystemContainer,
  resolveDeleteToTrashTarget,
} from "../systemContainerTrash";
import type { ContactsStore } from "./contactStore";
import { resolveContactsProjectionRootContainerId } from "./contactsSystemSlot";
import type { ContactsContextValue } from "./types";
import { useContactsStoreForContainer } from "./useContactsStoreForContainer";

interface ContactsProviderContextValue {
  canWrite: boolean;
  store: ContactsStore;
}

export const ContactsContext =
  createContext<ContactsProviderContextValue | null>(null);

type ContactsContextStoreFacade = Pick<
  ContactsStore,
  Extract<keyof ContactsStore, keyof ContactsContextValue>
>;

const contactsContextStoreKeys = defineFacadeKeys<ContactsContextStoreFacade>()(
  [
    "createContact",
    "importKey",
    "removeContact",
    "removeContactAvatar",
    "setContactAvatar",
    "updateContact",
  ],
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
  systemSlot: Parameters<typeof getExplorerSystemContainerId>[1];
}): {
  canWrite: boolean;
  id: string | null;
  organizationId: string | null;
  rootContainerId: string | null;
} {
  const id = getExplorerSystemContainerId(
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
  nodes: Parameters<typeof resolveContactsContainer>[0]["nodes"];
}) {
  const { appData, nodes } = input;
  const systemContainers = useUserSystemContainers();
  const contactsSystemSlot =
    findUserSystemContainer(systemContainers, "contacts")?.systemSlot ?? null;
  const trashSystemSlot =
    findUserSystemContainer(systemContainers, "trash")?.systemSlot ?? null;
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
  const containerContentsRuntime = useRuntimeScopedMemo(
    () => tearleads.containerContents.workflowRuntime(),
    [tearleads],
  );
  const { containerStore: containerContentsStore } =
    useDeviceFirstContainerContents();
  const hasRootContainerId = Boolean(
    containerContentsRuntime.state.containerId,
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
      nodes: containerContentsSnapshot.nodes,
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
      ...projectFacade(store, contactsContextStoreKeys),
      ...snapshot,
      canWrite,
    }),
    [canWrite, snapshot, store],
  );
}
