import type {
  ContainerContentsContextValue,
  ContainerContentsStore,
  ContainerNode,
  LocalProjectionView,
  ReconciliationService,
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
  canResolveExplorerTrashContainer,
  findExplorerSystemNode,
  getExplorerTrashDeleteTargetId,
  getVisibleExplorerNodes,
} from "./ExplorerSystemContainers";
import { useExplorerDeviceFirst } from "./useExplorerDeviceFirst";
import { useExplorerSystemProvisioning } from "./useExplorerSystemProvisioning";

export {
  canProvisionExplorerSystemContainers,
  getExplorerSystemContainerId,
  getExplorerTrashContainerId,
  getVisibleExplorerNodes,
} from "./ExplorerSystemContainers";

interface ExplorerContextModel {
  contactsSystemSlot: ContainerSystemSlot | null;
  logError: (message: string | Error, cause?: unknown) => void;
  reconciler: ReconciliationService;
  store: ContainerContentsStore;
  trashSystemSlot: ContainerSystemSlot | null;
  view: LocalProjectionView;
  visibleSystemSlots: ReadonlySet<ContainerSystemSlot>;
}

interface ExplorerContextValue extends ContainerContentsContextValue {
  canResolveTrashContainer: boolean;
  contactsSystemSlot: ContainerSystemSlot | null;
  ensureTrashContainer: () => Promise<ContainerNode | null>;
  reconciler: ReconciliationService;
  trashContainerId: string | null;
  view: LocalProjectionView;
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
  const snapshot = useTearleadsExternalStoreSnapshot(store);
  // Device-first read view (instant local tree + summaries) and the background
  // reconciler that patches it. Both share the mutation store's domain scope,
  // so reads and writes stay coherent.
  const { reconciler, view } = useExplorerDeviceFirst({
    domainScope: runtime.state.domainScope,
    events: appData.state.events,
    nodes: snapshot.nodes,
  });
  const {
    contactsSystemSlot,
    shouldProvisionSystemContainers,
    trashSystemSlot,
    visibleSystemSlots,
  } = useExplorerSystemProvisioning({
    store,
    ready: snapshot.ready,
    nodes: snapshot.nodes,
    signingPrivateKey: runtime.crypto.signingKeyPair?.signingPrivateKey ?? null,
    organizationId: runtime.auth.organizationId,
    rootContainerId: runtime.state.containerId,
    isAuthenticated: runtime.auth.isAuthenticated,
    logError: tearleads.logError,
  });
  const contextValue = useMemo(
    () => ({
      contactsSystemSlot,
      logError: tearleads.logError,
      reconciler,
      store,
      trashSystemSlot,
      view,
      visibleSystemSlots,
    }),
    [
      contactsSystemSlot,
      reconciler,
      store,
      tearleads.logError,
      trashSystemSlot,
      view,
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
    reconciler,
    store,
    trashSystemSlot,
    view,
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
      reconciler,
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
      view,
      visibleSystemSlots,
    }),
    [
      ensureTrashContainer,
      reconciler,
      snapshot,
      store,
      contactsSystemSlot,
      trashSystemSlot,
      view,
      visibleSystemSlots,
    ],
  );
}
