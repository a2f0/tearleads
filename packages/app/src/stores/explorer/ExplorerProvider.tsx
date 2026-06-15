import type {
  ContainerContentsContextValue,
  ContainerContentsStore,
  ContainerNode,
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
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../../providers/sdk/useTearleadsSubscription";
import {
  getContactsContainerId,
  useContactsCriticalNodesBootstrap,
} from "../contacts/useContactsCriticalNodesBootstrap";
import { useContactsStoreForContainer } from "../contacts/useContactsStoreForContainer";
import { EXPLORER_TRASH_CONTAINER_NAME } from "../systemContainers";
import {
  canProvisionExplorerSystemContainers,
  canResolveExplorerTrashContainer,
  findContactsSystemContainerSlot,
  findExplorerSystemNode,
  findTrashSystemContainerSlot,
  getExplorerOwnedSystemContainers,
  getExplorerTrashDeleteTargetId,
  getExplorerVisibleSystemSlots,
  getVisibleExplorerNodes,
  useEnsureExplorerSystemContainers,
  useExplorerSystemContainerSlots,
} from "./ExplorerSystemContainers";

export {
  canProvisionExplorerSystemContainers,
  getExplorerSystemContainerId,
  getExplorerTrashContainerId,
  getVisibleExplorerNodes,
} from "./ExplorerSystemContainers";

interface ExplorerContextModel {
  contactsSystemSlot: ContainerSystemSlot | null;
  logError: (message: string | Error, cause?: unknown) => void;
  store: ContainerContentsStore;
  trashSystemSlot: ContainerSystemSlot | null;
  visibleSystemSlots: ReadonlySet<ContainerSystemSlot>;
}

interface ExplorerContextValue extends ContainerContentsContextValue {
  canResolveTrashContainer: boolean;
  contactsSystemSlot: ContainerSystemSlot | null;
  ensureTrashContainer: () => Promise<ContainerNode | null>;
  trashContainerId: string | null;
  visibleSystemSlots: ReadonlySet<ContainerSystemSlot>;
}

const ExplorerContext = createContext<ExplorerContextModel | null>(null);

function useExplorerContactsCriticalNodesBootstrap(input: {
  contactsSystemSlot: ContainerSystemSlot | null;
  containerContentsReady: boolean;
  containerContentsStore: ContainerContentsStore;
  nodes: ReadonlyArray<ContainerNode>;
}): void {
  const contactsContainerId = useMemo(
    () => getContactsContainerId(input.nodes, input.contactsSystemSlot),
    [input.contactsSystemSlot, input.nodes],
  );
  const contactsStore = useContactsStoreForContainer(contactsContainerId);

  useContactsCriticalNodesBootstrap({
    contactsContainerId,
    contactsStore,
    contactsSystemSlot: input.contactsSystemSlot,
    containerContentsReady: input.containerContentsReady,
    containerContentsStore: input.containerContentsStore,
  });
}

export function ExplorerProvider({ children }: PropsWithChildren) {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const runtime = useMemo(
    () => tearleads.containerContents.workflowRuntime(),
    [appData, tearleads],
  );
  const store = useMemo(
    () => tearleads.containerContents.openTree({ logLabel: "Explorer" }),
    [runtime.state.domainScope, tearleads],
  );
  const systemContainers = useExplorerSystemContainerSlots({
    logError: tearleads.logError,
    signingPrivateKey: runtime.crypto.signingKeyPair?.signingPrivateKey ?? null,
  });
  const trashSystemSlot = findTrashSystemContainerSlot(systemContainers);
  const contactsSystemSlot = findContactsSystemContainerSlot(systemContainers);
  const visibleSystemSlots = useMemo(
    () => getExplorerVisibleSystemSlots(systemContainers),
    [systemContainers],
  );
  const explorerSystemContainers = useMemo(
    () => getExplorerOwnedSystemContainers(systemContainers),
    [systemContainers],
  );
  const snapshot = useTearleadsExternalStoreSnapshot(store);
  const shouldProvisionSystemContainers = useMemo(
    () =>
      canProvisionExplorerSystemContainers({
        isAuthenticated: runtime.auth.isAuthenticated,
        nodes: snapshot.nodes,
        organizationId: runtime.auth.organizationId,
        rootContainerId: runtime.state.containerId,
      }),
    [
      runtime.auth.isAuthenticated,
      runtime.auth.organizationId,
      runtime.state.containerId,
      snapshot.nodes,
    ],
  );
  const contextValue = useMemo(
    () => ({
      contactsSystemSlot,
      logError: tearleads.logError,
      store,
      trashSystemSlot,
      visibleSystemSlots,
    }),
    [
      contactsSystemSlot,
      store,
      tearleads.logError,
      trashSystemSlot,
      visibleSystemSlots,
    ],
  );

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  useExplorerContactsCriticalNodesBootstrap({
    contactsSystemSlot,
    containerContentsReady: snapshot.ready && shouldProvisionSystemContainers,
    containerContentsStore: store,
    nodes: snapshot.nodes,
  });

  useEnsureExplorerSystemContainers({
    containerContentsReady: snapshot.ready,
    containerContentsStore: store,
    logError: tearleads.logError,
    nodes: snapshot.nodes,
    shouldProvisionSystemContainers,
    systemContainers: explorerSystemContainers,
  });

  return (
    <ExplorerContext.Provider value={contextValue}>
      {children}
    </ExplorerContext.Provider>
  );
}

export function useExplorer(): ExplorerContextValue {
  const context = useContext(ExplorerContext);
  if (!context) {
    throw new Error("useExplorer must be used within an ExplorerProvider.");
  }

  const {
    contactsSystemSlot,
    logError,
    store,
    trashSystemSlot,
    visibleSystemSlots,
  } = context;
  const snapshot = useTearleadsExternalStoreSnapshot(store);
  const ensureTrashContainer = useCallback(async () => {
    if (!trashSystemSlot) {
      return null;
    }

    const currentSnapshot = store.getSnapshot();
    if (!currentSnapshot.ready) {
      return null;
    }

    const currentTrashNode = findExplorerSystemNode(
      currentSnapshot.nodes,
      trashSystemSlot,
    );
    if (currentTrashNode) {
      return currentTrashNode;
    }

    try {
      return await store.ensureSystemContainer(
        trashSystemSlot,
        EXPLORER_TRASH_CONTAINER_NAME,
      );
    } catch (error) {
      logError("Failed to ensure explorer trash container", error);
      return null;
    }
  }, [logError, store, trashSystemSlot]);

  return useMemo(
    () => ({
      canResolveTrashContainer:
        snapshot.ready && canResolveExplorerTrashContainer(trashSystemSlot),
      contactsSystemSlot,
      createChild: store.createChild,
      deleteContainer: store.deleteContainer,
      ensureTrashContainer,
      ensureSystemContainer: store.ensureSystemContainer,
      moveContainer: store.moveContainer,
      refresh: store.refresh,
      renameContainer: store.renameContainer,
      shareWithGroup: store.shareWithGroup,
      shareWithUser: store.shareWithUser,
      nodes: getVisibleExplorerNodes(snapshot.nodes, visibleSystemSlots),
      ready: snapshot.ready,
      trashContainerId: getExplorerTrashDeleteTargetId(
        snapshot.nodes,
        trashSystemSlot,
      ),
      visibleSystemSlots,
    }),
    [
      ensureTrashContainer,
      snapshot,
      store,
      contactsSystemSlot,
      trashSystemSlot,
      visibleSystemSlots,
    ],
  );
}
