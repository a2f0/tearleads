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
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../../providers/sdk/useTearleadsSubscription";
import { useDeviceFirstContainerContents } from "../device-first/DeviceFirstProvider";
import {
  EXPLORER_TRASH_CONTAINER_ICON,
  EXPLORER_TRASH_CONTAINER_NAME,
} from "../systemContainers";
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
  contactsSystemSlot: ContainerSystemSlot | null;
  currentOrganizationId: string | null;
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
  trashSystemSlot: ContainerSystemSlot | null;
  view: LocalProjectionView;
  visibleSystemSlots: ReadonlySet<ContainerSystemSlot>;
}

const ExplorerContext = createContext<ExplorerContextModel | null>(null);
const EXPLORER_TRASH_CONTAINER_ENSURE_OPTIONS = {
  deferRemoteBootstrap: true,
  icon: EXPLORER_TRASH_CONTAINER_ICON,
} as const;

function ensureExplorerTrashContainer(
  store: ContainerContentsStore,
  trashSystemSlot: ContainerSystemSlot,
): Promise<ContainerNode | null> {
  return store.ensureSystemContainer(
    trashSystemSlot,
    EXPLORER_TRASH_CONTAINER_NAME,
    EXPLORER_TRASH_CONTAINER_ENSURE_OPTIONS,
  );
}

export function ExplorerProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const { reconciler, runtime, view } = useDeviceFirstContainerContents();
  const store = useMemo(
    () => tearleads.containerContents.openTree({ logLabel: "Explorer" }),
    [runtime.state.domainScope, tearleads],
  );
  const { contactsSystemSlot, trashSystemSlot, visibleSystemSlots } =
    useExplorerSystemProvisioning({
      signingPrivateKey:
        runtime.crypto.signingKeyPair?.signingPrivateKey ?? null,
      logError: tearleads.logError,
    });
  const contextValue = useMemo(
    () => ({
      contactsSystemSlot,
      currentOrganizationId: runtime.auth.organizationId,
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
      runtime.auth.organizationId,
      store,
      tearleads.logError,
      trashSystemSlot,
      view,
      visibleSystemSlots,
    ],
  );

  useEffect(() => {
    if (runtime.infra.dbStatus === "ready" && !runtime.state.containerId) {
      return;
    }

    store.updateRuntime(runtime);
  }, [store, runtime]);

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
    currentOrganizationId,
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
      // Delete-to-trash is device-first. If Trash is missing, create the local
      // system container immediately and let the structural sync lane reconcile
      // it before queued document moves replay.
      return await ensureExplorerTrashContainer(store, trashSystemSlot);
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
      purgeContainer: store.purgeContainer,
      reconciler,
      refresh: store.refresh,
      refreshRootLane: store.refreshRootLane,
      renameContainer: store.renameContainer,
      requestSync: store.requestSync,
      shareWithGroup: store.shareWithGroup,
      shareWithUser: store.shareWithUser,
      nodes: getVisibleExplorerNodes(
        snapshot.nodes,
        visibleSystemSlots,
        currentOrganizationId,
      ),
      ready: snapshot.ready,
      trashContainerId: getExplorerTrashDeleteTargetId(
        snapshot.nodes,
        trashSystemSlot,
      ),
      trashSystemSlot,
      view,
      visibleSystemSlots,
    }),
    [
      ensureTrashContainer,
      reconciler,
      snapshot,
      store,
      contactsSystemSlot,
      currentOrganizationId,
      trashSystemSlot,
      view,
      visibleSystemSlots,
    ],
  );
}
