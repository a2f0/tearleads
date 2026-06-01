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
  useRef,
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

const USER_SYSTEM_CONTAINER_NAMES = new Set(
  USER_SYSTEM_CONTAINER_DEFINITIONS.map((definition) => definition.name),
);

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
  visibleSystemSlots: ReadonlySet<ContainerSystemSlot>;
}

const ExplorerContext = createContext<ExplorerContextModel | null>(null);

export function getVisibleExplorerNodes(
  nodes: ContainerContentsContextValue["nodes"] | null | undefined,
  visibleSystemSlots?: ReadonlySet<ContainerSystemSlot>,
): ContainerContentsContextValue["nodes"] {
  const hasResolvedVisibleSystemSlots =
    visibleSystemSlots !== undefined && visibleSystemSlots.size > 0;

  return (nodes ?? []).filter((node) => {
    const systemSlot = node.systemSlot ?? null;
    if (!systemSlot) {
      return true;
    }

    if (hasResolvedVisibleSystemSlots) {
      return visibleSystemSlots.has(systemSlot);
    }

    return USER_SYSTEM_CONTAINER_NAMES.has(node.name);
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
  const inFlightSystemSlotsRef = useRef(new Set<ContainerSystemSlot>());

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
      (systemContainer) =>
        !existingSystemSlots.has(systemContainer.systemSlot) &&
        !inFlightSystemSlotsRef.current.has(systemContainer.systemSlot),
    );
    if (missingSystemContainers.length === 0) {
      return;
    }

    let cancelled = false;
    const provisionMissingSystemContainers = () => {
      for (const systemContainer of missingSystemContainers) {
        inFlightSystemSlotsRef.current.add(systemContainer.systemSlot);
        void input.containerContentsStore
          .ensureSystemContainer(
            systemContainer.systemSlot,
            systemContainer.name,
          )
          .catch((error) => {
            if (!cancelled) {
              input.logError(
                `Failed to provision explorer ${systemContainer.name} system container`,
                error,
              );
            }
          })
          .finally(() => {
            inFlightSystemSlotsRef.current.delete(systemContainer.systemSlot);
          });
      }
    };
    const provisionTimer = window.setTimeout(
      provisionMissingSystemContainers,
      100,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(provisionTimer);
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

export function canProvisionExplorerSystemContainers(input: {
  isAuthenticated: boolean;
  nodes: ReadonlyArray<ContainerNode> | null | undefined;
  organizationId: string | null;
  rootContainerId: string | null;
}): boolean {
  if (!input.isAuthenticated) {
    return true;
  }

  if (!input.organizationId || !input.rootContainerId) {
    return false;
  }

  return (
    input.nodes?.some(
      (node) =>
        node.id === input.rootContainerId &&
        node.parentId === null &&
        node.organizationId === input.organizationId,
    ) ?? false
  );
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
    shouldProvisionSystemContainers,
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
      visibleSystemSlots,
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
