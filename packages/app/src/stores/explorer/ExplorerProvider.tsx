import type {
  ContainerContentsContextValue,
  ContainerContentsStore,
  ContainerNode,
  ContainerSystemSlotDefinition,
} from "@tearleads/client-sdk";
import { deriveContainerSystemSlot } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
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

interface ExplorerContextModel {
  logError: (message: string | Error, cause?: unknown) => void;
  store: ContainerContentsStore;
  trashSystemSlot: ContainerSystemSlot | null;
}

interface ExplorerContextValue extends ContainerContentsContextValue {
  canResolveTrashContainer: boolean;
  ensureTrashContainer: () => Promise<ContainerNode | null>;
  trashContainerId: string | null;
}

const EXPLORER_TRASH_CONTAINER_NAME = "Trash";
const EXPLORER_TRASH_CONTAINER_SYSTEM_SLOT_DEFINITION: ContainerSystemSlotDefinition =
  {
    namespace: "tearleads.explorer",
    projectorId: "explorer",
    slotId: "trash",
    version: 1,
  };

const ExplorerContext = createContext<ExplorerContextModel | null>(null);

export function getVisibleExplorerNodes(
  nodes: ContainerContentsContextValue["nodes"] | null | undefined,
): ContainerContentsContextValue["nodes"] {
  return (nodes ?? []).filter((node) => !node.systemSlot);
}

function findExplorerSystemNode(
  nodes: ReadonlyArray<ContainerNode> | null | undefined,
  systemSlot: ContainerSystemSlot | null,
): ContainerNode | null {
  if (!systemSlot || !nodes) {
    return null;
  }

  return nodes.find((node) => node.systemSlot === systemSlot) ?? null;
}

export function getExplorerTrashContainerId(
  nodes: ReadonlyArray<ContainerNode> | null | undefined,
  trashSystemSlot: ContainerSystemSlot | null,
): string | null {
  return findExplorerSystemNode(nodes, trashSystemSlot)?.id ?? null;
}

function getExplorerTrashDeleteTargetId(
  nodes: ReadonlyArray<ContainerNode> | null | undefined,
  trashSystemSlot: ContainerSystemSlot | null,
): string | null {
  return getExplorerTrashContainerId(nodes, trashSystemSlot);
}

function canResolveExplorerTrashContainer(
  trashSystemSlot: ContainerSystemSlot | null,
): boolean {
  return trashSystemSlot !== null;
}

function useExplorerTrashSystemSlot(input: {
  logError: (message: string | Error, cause?: unknown) => void;
  signingPrivateKey: Uint8Array | null;
}): ContainerSystemSlot | null {
  const [trashSystemSlot, setTrashSystemSlot] =
    useState<ContainerSystemSlot | null>(null);

  useEffect(() => {
    if (!input.signingPrivateKey) {
      setTrashSystemSlot(null);
      return;
    }

    let cancelled = false;
    void deriveContainerSystemSlot({
      definition: EXPLORER_TRASH_CONTAINER_SYSTEM_SLOT_DEFINITION,
      secretKey: input.signingPrivateKey,
    })
      .then((systemSlot) => {
        if (!cancelled) {
          setTrashSystemSlot(systemSlot);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTrashSystemSlot(null);
          input.logError("Failed to derive explorer trash system slot", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [input.logError, input.signingPrivateKey]);

  return trashSystemSlot;
}

function useEnsureExplorerTrashContainer(input: {
  containerContentsReady: boolean;
  containerContentsStore: Pick<ContainerContentsStore, "ensureSystemContainer">;
  logError: (message: string | Error, cause?: unknown) => void;
  shouldProvisionTrashContainer: boolean;
  trashContainerId: string | null;
  trashSystemSlot: ContainerSystemSlot | null;
}): void {
  useEffect(() => {
    if (
      !input.containerContentsReady ||
      !input.shouldProvisionTrashContainer ||
      !input.trashSystemSlot ||
      input.trashContainerId
    ) {
      return;
    }

    let cancelled = false;
    void input.containerContentsStore
      .ensureSystemContainer(
        input.trashSystemSlot,
        EXPLORER_TRASH_CONTAINER_NAME,
      )
      .catch((error) => {
        if (!cancelled) {
          input.logError("Failed to provision explorer trash container", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    input.containerContentsReady,
    input.containerContentsStore,
    input.logError,
    input.shouldProvisionTrashContainer,
    input.trashContainerId,
    input.trashSystemSlot,
  ]);
}

export function ExplorerProvider({ children }: PropsWithChildren) {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const runtime = useMemo(
    () => tearleads.containerContents.runtime(),
    [appData, tearleads],
  );
  const store = useMemo(
    () => tearleads.containerContents.store({ logLabel: "Explorer" }),
    [runtime.state.domainScope, tearleads],
  );
  const trashSystemSlot = useExplorerTrashSystemSlot({
    logError: tearleads.logError,
    signingPrivateKey: runtime.crypto.signingKeyPair?.signingPrivateKey ?? null,
  });
  const snapshot = useTearleadsExternalStoreSnapshot(store);
  const trashContainerId = useMemo(
    () => getExplorerTrashContainerId(snapshot.nodes, trashSystemSlot),
    [snapshot.nodes, trashSystemSlot],
  );
  const contextValue = useMemo(
    () => ({ logError: tearleads.logError, store, trashSystemSlot }),
    [store, tearleads.logError, trashSystemSlot],
  );

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  useEnsureExplorerTrashContainer({
    containerContentsReady: snapshot.ready,
    containerContentsStore: store,
    logError: tearleads.logError,
    shouldProvisionTrashContainer: !runtime.auth.isAuthenticated,
    trashContainerId,
    trashSystemSlot,
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

  const { logError, store, trashSystemSlot } = context;
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
      createChild: store.createChild,
      deleteContainer: store.deleteContainer,
      ensureTrashContainer,
      ensureSystemContainer: store.ensureSystemContainer,
      moveContainer: store.moveContainer,
      refresh: store.refresh,
      renameContainer: store.renameContainer,
      shareWithGroup: store.shareWithGroup,
      shareWithUser: store.shareWithUser,
      nodes: getVisibleExplorerNodes(snapshot.nodes),
      ready: snapshot.ready,
      trashContainerId: getExplorerTrashDeleteTargetId(
        snapshot.nodes,
        trashSystemSlot,
      ),
    }),
    [ensureTrashContainer, snapshot, store, trashSystemSlot],
  );
}
