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
} from "../../data/containerPersistence";
import type { ExecSql } from "../../data/sqlSchema";
import type { ContainerNode } from "./types";

type ExplorerAppData = ReturnType<typeof useAppData>;

interface ExplorerContextValue {
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
  getSnapshot: () => ExplorerSnapshot;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: ExplorerRuntime) => void;
}

const explorerStoresByScope = new WeakMap<object, ExplorerStore>();
const ExplorerContext = createContext<ExplorerStore | null>(null);

function createExplorerStore(initialRuntime: ExplorerRuntime): ExplorerStore {
  let runtime = initialRuntime;
  let initialized = false;
  let initializePromise: Promise<void> | null = null;
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
    const nodes: ContainerNode[] = records.map((record) => ({
      id: record.id,
      name: record.name,
      parentId: record.parentId,
      kind: "container",
    }));

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

  return snapshot;
}
