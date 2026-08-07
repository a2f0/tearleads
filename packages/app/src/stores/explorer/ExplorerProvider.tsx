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
  useMemo,
} from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../../providers/sdk/useTearleadsSubscription";
import { useDeviceFirstContainerContents } from "../device-first/DeviceFirstProvider";
import type { BuiltInSystemContainer } from "../systemContainers";
import { ensureTrashSystemContainer } from "../systemContainerTrash";
import {
  canResolveExplorerTrashContainer,
  findExplorerSystemNode,
  getExplorerTrashDeleteTargetId,
  getVisibleExplorerNodes,
} from "./ExplorerSystemContainers";
import { useExplorerSystemProvisioning } from "./useExplorerSystemProvisioning";

export {
  canProvisionExplorerSystemContainers,
  getExplorerSystemContainerId,
  getExplorerTrashContainerId,
  getVisibleExplorerNodes,
} from "./ExplorerSystemContainers";

interface ExplorerContextModel {
  builtInSystemContainers: ReadonlyArray<BuiltInSystemContainer>;
  contactsSystemSlot: ContainerSystemSlot | null;
  currentOrganizationId: string | null;
  currentRootContainerId: string | null;
  logError: (message: string | Error, cause?: unknown) => void;
  reconciler: ReconciliationService;
  store: ContainerContentsStore;
  trashSystemSlot: ContainerSystemSlot | null;
  view: LocalProjectionView;
  visibleSystemSlots: ReadonlySet<ContainerSystemSlot>;
}

interface ExplorerContextValue extends ContainerContentsContextValue {
  builtInSystemContainers: ReadonlyArray<BuiltInSystemContainer>;
  canResolveTrashContainer: boolean;
  contactsSystemSlot: ContainerSystemSlot | null;
  ensureTrashContainer: () => Promise<ContainerNode | null>;
  reconciler: ReconciliationService;
  trashContainerId: string | null;
  trashSystemSlot: ContainerSystemSlot | null;
  view: LocalProjectionView;
  visibleSystemSlots: ReadonlySet<ContainerSystemSlot>;
}

const ExplorerContext = createContext<ExplorerContextModel | null>(null);

function useEnsureExplorerTrashContainer(
  context: ExplorerContextModel,
): () => Promise<ContainerNode | null> {
  const {
    currentOrganizationId,
    currentRootContainerId,
    logError,
    store,
    trashSystemSlot,
  } = context;

  return useCallback(async () => {
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
      currentOrganizationId,
      currentRootContainerId,
    );
    if (currentTrashNode) {
      return currentTrashNode;
    }

    try {
      return await ensureTrashSystemContainer(store, trashSystemSlot);
    } catch (error) {
      logError("Failed to ensure explorer trash container", error);
      return null;
    }
  }, [
    currentOrganizationId,
    currentRootContainerId,
    logError,
    store,
    trashSystemSlot,
  ]);
}

export function ExplorerProvider({
  children,
  showBuiltInSystemContainers = false,
}: PropsWithChildren<{ showBuiltInSystemContainers?: boolean }>) {
  const tearleads = useTearleads();
  const {
    containerStore: store,
    reconciler,
    runtime,
    view,
  } = useDeviceFirstContainerContents();
  const {
    builtInSystemContainers,
    contactsSystemSlot,
    trashSystemSlot,
    visibleSystemSlots,
  } = useExplorerSystemProvisioning({
    organizationId: runtime.auth.organizationId,
    signingPrivateKey: runtime.crypto.signingKeyPair?.signingPrivateKey ?? null,
    showBuiltInSystemContainers,
    logError: tearleads.logError,
  });
  const contextValue = useMemo(
    () => ({
      builtInSystemContainers,
      contactsSystemSlot,
      currentOrganizationId: runtime.auth.organizationId,
      currentRootContainerId: runtime.state.containerId,
      logError: tearleads.logError,
      reconciler,
      store,
      trashSystemSlot,
      view,
      visibleSystemSlots,
    }),
    [
      builtInSystemContainers,
      contactsSystemSlot,
      reconciler,
      runtime.auth.organizationId,
      runtime.state.containerId,
      store,
      tearleads.logError,
      trashSystemSlot,
      view,
      visibleSystemSlots,
    ],
  );

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
    builtInSystemContainers,
    contactsSystemSlot,
    currentOrganizationId,
    currentRootContainerId,
    reconciler,
    store,
    trashSystemSlot,
    view,
    visibleSystemSlots,
  } = context;
  const snapshot = useTearleadsExternalStoreSnapshot(store);
  const ensureTrashContainer = useEnsureExplorerTrashContainer(context);

  return useMemo(
    () => ({
      // deleteContainer is part of the SDK store context contract
      // (ContainerContentsContextValue), so the context value must carry it. The
      // explorer UI no longer wires it to any menu action — folders are removed
      // by moving them to Trash and purging from there — so the narrower
      // ExplorerModelExplorer omits it.
      ...store,
      ...snapshot,
      builtInSystemContainers,
      canResolveTrashContainer:
        snapshot.ready && canResolveExplorerTrashContainer(trashSystemSlot),
      contactsSystemSlot,
      ensureTrashContainer,
      reconciler,
      nodes: getVisibleExplorerNodes(
        snapshot.nodes,
        visibleSystemSlots,
        currentOrganizationId,
      ),
      trashContainerId: getExplorerTrashDeleteTargetId(
        snapshot.nodes,
        trashSystemSlot,
        currentOrganizationId,
        currentRootContainerId,
      ),
      trashSystemSlot,
      view,
      visibleSystemSlots,
    }),
    [
      builtInSystemContainers,
      ensureTrashContainer,
      reconciler,
      snapshot,
      store,
      contactsSystemSlot,
      currentOrganizationId,
      currentRootContainerId,
      trashSystemSlot,
      view,
      visibleSystemSlots,
    ],
  );
}
