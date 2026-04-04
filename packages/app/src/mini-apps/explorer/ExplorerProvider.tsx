import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useAppData } from "../../data/AppDataProvider";
import {
  deleteContainer as deleteContainerRecord,
  ensureContainerTables,
  loadContainers,
  saveContainer,
} from "../../data/containerPersistence";
import type { ExecSql } from "../../data/sqlSchema";
import type { ContainerNode } from "./types";

type ExplorerAppData = ReturnType<typeof useAppData>;

interface ExplorerContextValue {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

interface ExplorerSnapshot {
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

interface ExplorerRuntime {
  apiClient: Pick<ExplorerAppData["apiClient"], "createContainer">;
  dbStatus: ExplorerAppData["dbStatus"];
  domainScope: ExplorerAppData["domainScope"];
  execSql: ExecSql;
  isAuthenticated: ExplorerAppData["isAuthenticated"];
  log: ExplorerAppData["log"];
}

interface ExplorerStore {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  getSnapshot: () => ExplorerSnapshot;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: ExplorerRuntime) => void;
}

const explorerStoresByScope = new WeakMap<object, ExplorerStore>();
const ExplorerContext = createContext<ExplorerStore | null>(null);

function sortNodes(
  nodes: ReadonlyArray<ContainerNode>,
): ReadonlyArray<ContainerNode> {
  return [...nodes].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    }),
  );
}

function toContainerNode(record: {
  id: string;
  organizationId: string;
  parentId: string | null;
  name: string;
}): ContainerNode {
  return {
    id: record.id,
    kind: "container",
    name: record.name,
    organizationId: record.organizationId,
    parentId: record.parentId,
  };
}

export function createExplorerStore(
  initialRuntime: ExplorerRuntime,
): ExplorerStore {
  let runtime = initialRuntime;
  let initialized = false;
  let initializePromise: Promise<void> | null = null;
  let writeChain = Promise.resolve<ContainerNode | null>(null);
  const listeners = new Set<() => void>();

  let snapshot: ExplorerSnapshot = {
    nodes: [],
    ready: false,
  };

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function setSnapshot(next: ExplorerSnapshot) {
    if (next.ready === snapshot.ready && next.nodes === snapshot.nodes) {
      return;
    }
    snapshot = next;
    emit();
  }

  async function initialize() {
    if (runtime.dbStatus !== "ready") {
      return;
    }

    await ensureContainerTables(runtime.execSql);
    const records = await loadContainers(runtime.execSql);
    const nodes = sortNodes(records.map((record) => toContainerNode(record)));

    initialized = true;
    initializePromise = null;
    runtime.log(`Explorer: loaded ${nodes.length} container(s)`);
    setSnapshot({ nodes, ready: true });
  }

  function ensureInitialized() {
    if (initialized || initializePromise || runtime.dbStatus !== "ready") {
      return;
    }

    initializePromise = initialize().catch((error: unknown) => {
      initializePromise = null;

      if (
        error instanceof Error &&
        error.message === "Database worker client has been destroyed."
      ) {
        return;
      }

      throw error;
    });
  }

  return {
    createChild(parentId, name) {
      const trimmedName = name.trim();
      if (runtime.dbStatus !== "ready" || !snapshot.ready || !trimmedName) {
        return Promise.resolve(null);
      }

      writeChain = writeChain
        .catch(() => null)
        .then(async () => {
          const parent = snapshot.nodes.find((node) => node.id === parentId);
          if (!parent) {
            return null;
          }

          const childId = crypto.randomUUID();
          const createdRecord = runtime.isAuthenticated
            ? await runtime.apiClient.createContainer(
                childId,
                parent.id,
                trimmedName,
              )
            : {
                id: childId,
                organizationId: parent.organizationId,
                parentId: parent.id,
                name: trimmedName,
              };

          if (!createdRecord) {
            return null;
          }

          const childNode: ContainerNode = {
            id: createdRecord.id,
            kind: "container",
            name: createdRecord.name,
            organizationId: createdRecord.organizationId,
            parentId: createdRecord.parentId,
          };

          await saveContainer(runtime.execSql, {
            id: childNode.id,
            organizationId: childNode.organizationId,
            parentId: childNode.parentId,
            name: childNode.name,
          });

          setSnapshot({
            nodes: sortNodes([...snapshot.nodes, childNode]),
            ready: true,
          });
          runtime.log(`Explorer: created container "${trimmedName}"`);
          return childNode;
        });

      return writeChain;
    },

    deleteContainer(containerId) {
      if (runtime.dbStatus !== "ready" || !snapshot.ready) {
        return Promise.resolve(false);
      }

      writeChain = writeChain
        .catch(() => null)
        .then(async () => {
          const existingNode = snapshot.nodes.find(
            (node) => node.id === containerId,
          );
          if (
            !existingNode ||
            existingNode.parentId === null ||
            snapshot.nodes.some((node) => node.parentId === containerId)
          ) {
            return null;
          }

          await deleteContainerRecord(runtime.execSql, existingNode.id);

          setSnapshot({
            nodes: sortNodes(
              snapshot.nodes.filter((node) => node.id !== existingNode.id),
            ),
            ready: true,
          });
          runtime.log(`Explorer: deleted container "${existingNode.name}"`);
          return existingNode;
        });

      return writeChain.then((deletedNode) => deletedNode !== null);
    },

    renameContainer(containerId, name) {
      const trimmedName = name.trim();
      if (runtime.dbStatus !== "ready" || !snapshot.ready || !trimmedName) {
        return Promise.resolve(null);
      }

      writeChain = writeChain
        .catch(() => null)
        .then(async () => {
          const existingNode = snapshot.nodes.find(
            (node) => node.id === containerId,
          );
          if (!existingNode) {
            return null;
          }

          if (existingNode.name === trimmedName) {
            return existingNode;
          }

          const renamedNode: ContainerNode = {
            ...existingNode,
            name: trimmedName,
          };

          await saveContainer(runtime.execSql, {
            id: renamedNode.id,
            organizationId: renamedNode.organizationId,
            parentId: renamedNode.parentId,
            name: renamedNode.name,
          });

          setSnapshot({
            nodes: sortNodes(
              snapshot.nodes.map((node) =>
                node.id === renamedNode.id ? renamedNode : node,
              ),
            ),
            ready: true,
          });
          runtime.log(`Explorer: renamed container to "${trimmedName}"`);
          return renamedNode;
        });

      return writeChain;
    },

    getSnapshot() {
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    updateRuntime(nextRuntime) {
      runtime = nextRuntime;
      ensureInitialized();
    },
  };
}

function getOrCreateExplorerStore(
  domainScope: object,
  runtime: ExplorerRuntime,
): ExplorerStore {
  const existingStore = explorerStoresByScope.get(domainScope);
  if (existingStore) {
    return existingStore;
  }

  const nextStore = createExplorerStore(runtime);
  explorerStoresByScope.set(domainScope, nextStore);
  return nextStore;
}

export function ExplorerProvider({ children }: PropsWithChildren) {
  const runtime = useAppData();
  const store = useMemo(
    () => getOrCreateExplorerStore(runtime.domainScope, runtime),
    [runtime.domainScope],
  );

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  return (
    <ExplorerContext.Provider value={store}>
      {children}
    </ExplorerContext.Provider>
  );
}

export function useExplorer(): ExplorerContextValue {
  const store = useContext(ExplorerContext);
  if (!store) {
    throw new Error("useExplorer must be used within an ExplorerProvider.");
  }

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  return useMemo(
    () => ({
      createChild: store.createChild,
      deleteContainer: store.deleteContainer,
      nodes: snapshot.nodes,
      renameContainer: store.renameContainer,
      ready: snapshot.ready,
    }),
    [snapshot, store],
  );
}
