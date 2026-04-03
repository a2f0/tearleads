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
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

interface ExplorerSnapshot {
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

interface ExplorerRuntime {
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

          const childNode: ContainerNode = {
            id: crypto.randomUUID(),
            kind: "container",
            name: trimmedName,
            organizationId: parent.organizationId,
            parentId: parent.id,
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
      nodes: snapshot.nodes,
      ready: snapshot.ready,
    }),
    [snapshot, store],
  );
}
