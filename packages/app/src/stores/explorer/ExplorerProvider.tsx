import type {
  ContainerContentsContextValue,
  ContainerContentsStore,
  ContainerNode,
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
import {
  EXPLORER_TRASH_CONTAINER_NAME,
  USER_SYSTEM_CONTAINER_DEFINITIONS,
  type UserSystemContainerKind,
} from "../systemContainers";

interface ExplorerSystemContainer {
  kind: UserSystemContainerKind;
  name: string;
  systemSlot: ContainerSystemSlot;
}

interface ExplorerContextModel {
  logError: (message: string | Error, cause?: unknown) => void;
  store: ContainerContentsStore;
  trashSystemSlot: ContainerSystemSlot | null;
  visibleSystemSlots: ReadonlySet<ContainerSystemSlot>;
}

interface ExplorerContextValue extends ContainerContentsContextValue {
  canResolveTrashContainer: boolean;
  ensureTrashContainer: () => Promise<ContainerNode | null>;
  trashContainerId: string | null;
}

const ExplorerContext = createContext<ExplorerContextModel | null>(null);

export function getVisibleExplorerNodes(
  nodes: ContainerContentsContextValue["nodes"] | null | undefined,
  visibleSystemSlots?: ReadonlySet<ContainerSystemSlot>,
): ContainerContentsContextValue["nodes"] {
  return (nodes ?? []).filter((node) => {
    const systemSlot = node.systemSlot ?? null;
    return !systemSlot || visibleSystemSlots?.has(systemSlot) === true;
  });
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

export function getExplorerSystemContainerId(
  nodes: ReadonlyArray<ContainerNode> | null | undefined,
  systemSlot: ContainerSystemSlot | null,
): string | null {
  return findExplorerSystemNode(nodes, systemSlot)?.id ?? null;
}

export function getExplorerTrashContainerId(
  nodes: ReadonlyArray<ContainerNode> | null | undefined,
  trashSystemSlot: ContainerSystemSlot | null,
): string | null {
  return getExplorerSystemContainerId(nodes, trashSystemSlot);
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

function useExplorerSystemContainerSlots(input: {
  logError: (message: string | Error, cause?: unknown) => void;
  signingPrivateKey: Uint8Array | null;
}): ReadonlyArray<ExplorerSystemContainer> {
  const [systemContainers, setSystemContainers] = useState<
    ReadonlyArray<ExplorerSystemContainer>
  >([]);

  useEffect(() => {
    if (!input.signingPrivateKey) {
      setSystemContainers([]);
      return;
    }

    const signingPrivateKey = input.signingPrivateKey;
    let cancelled = false;
    void Promise.all(
      USER_SYSTEM_CONTAINER_DEFINITIONS.map(async (definition) => ({
        kind: definition.kind,
        name: definition.name,
        systemSlot: await deriveContainerSystemSlot({
          definition: definition.slotDefinition,
          secretKey: signingPrivateKey,
        }),
      })),
    )
      .then((nextSystemContainers) => {
        if (!cancelled) {
          setSystemContainers(nextSystemContainers);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSystemContainers([]);
          input.logError("Failed to derive explorer system slots", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [input.logError, input.signingPrivateKey]);

  return systemContainers;
}

function useEnsureExplorerSystemContainers(input: {
  containerContentsReady: boolean;
  containerContentsStore: Pick<ContainerContentsStore, "ensureSystemContainer">;
  logError: (message: string | Error, cause?: unknown) => void;
  nodes: ReadonlyArray<ContainerNode>;
  shouldProvisionSystemContainers: boolean;
  systemContainers: ReadonlyArray<ExplorerSystemContainer>;
}): void {
  useEffect(() => {
    if (
      !input.containerContentsReady ||
      !input.shouldProvisionSystemContainers ||
      input.systemContainers.length === 0
    ) {
      return;
    }

    const existingSystemSlots = new Set(
      input.nodes.flatMap((node) => {
        const systemSlot = node.systemSlot ?? null;
        return systemSlot ? [systemSlot] : [];
      }),
    );
    const missingSystemContainers = input.systemContainers.filter(
      (systemContainer) => !existingSystemSlots.has(systemContainer.systemSlot),
    );
    if (missingSystemContainers.length === 0) {
      return;
    }

    let cancelled = false;
    for (const systemContainer of missingSystemContainers) {
      void input.containerContentsStore
        .ensureSystemContainer(systemContainer.systemSlot, systemContainer.name)
        .catch((error) => {
          if (!cancelled) {
            input.logError(
              `Failed to provision explorer ${systemContainer.name} system container`,
              error,
            );
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [
    input.containerContentsReady,
    input.containerContentsStore,
    input.logError,
    input.nodes,
    input.shouldProvisionSystemContainers,
    input.systemContainers,
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
  const systemContainers = useExplorerSystemContainerSlots({
    logError: tearleads.logError,
    signingPrivateKey: runtime.crypto.signingKeyPair?.signingPrivateKey ?? null,
  });
  const trashSystemSlot = useMemo(
    () =>
      systemContainers.find(
        (systemContainer) => systemContainer.kind === "trash",
      )?.systemSlot ?? null,
    [systemContainers],
  );
  const visibleSystemSlots = useMemo(
    () =>
      new Set(
        systemContainers.map((systemContainer) => systemContainer.systemSlot),
      ),
    [systemContainers],
  );
  const snapshot = useTearleadsExternalStoreSnapshot(store);
  const contextValue = useMemo(
    () => ({
      logError: tearleads.logError,
      store,
      trashSystemSlot,
      visibleSystemSlots,
    }),
    [store, tearleads.logError, trashSystemSlot, visibleSystemSlots],
  );

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  useEnsureExplorerSystemContainers({
    containerContentsReady: snapshot.ready,
    containerContentsStore: store,
    logError: tearleads.logError,
    nodes: snapshot.nodes,
    shouldProvisionSystemContainers: !runtime.auth.isAuthenticated,
    systemContainers,
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

  const { logError, store, trashSystemSlot, visibleSystemSlots } = context;
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
      nodes: getVisibleExplorerNodes(snapshot.nodes, visibleSystemSlots),
      ready: snapshot.ready,
      trashContainerId: getExplorerTrashDeleteTargetId(
        snapshot.nodes,
        trashSystemSlot,
      ),
    }),
    [
      ensureTrashContainer,
      snapshot,
      store,
      trashSystemSlot,
      visibleSystemSlots,
    ],
  );
}
