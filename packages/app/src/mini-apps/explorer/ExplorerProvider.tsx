import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useAppData } from "../../data/AppDataProvider";
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

export interface ExplorerRuntime {
  dbStatus: ExplorerAppData["dbStatus"];
  domainScope: ExplorerAppData["domainScope"];
  isAuthenticated: ExplorerAppData["isAuthenticated"];
  log: ExplorerAppData["log"];
}

interface ExplorerStore {
  getSnapshot: () => ExplorerSnapshot;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: ExplorerRuntime) => void;
}

const ROOT_CONTAINER_ID = "root";
const explorerStoresByScope = new WeakMap<object, ExplorerStore>();
const ExplorerContext = createContext<ExplorerStore | null>(null);

export function createExplorerStore(
  initialRuntime: ExplorerRuntime,
): ExplorerStore {
  let runtime = initialRuntime;
  let initialized = false;
  const listeners = new Set<() => void>();

  const rootNode: ContainerNode = {
    id: ROOT_CONTAINER_ID,
    name: "/",
    parentId: null,
    kind: "container",
  };

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

  function ensureInitialized() {
    if (initialized || runtime.dbStatus !== "ready") {
      return;
    }
    initialized = true;
    runtime.log("Explorer: initializing with root container");
    setSnapshot({ nodes: [rootNode], ready: true });
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
      const previousRuntime = runtime;
      runtime = nextRuntime;

      if (previousRuntime.domainScope !== nextRuntime.domainScope) {
        return;
      }

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
      nodes: snapshot.nodes,
      ready: snapshot.ready,
    }),
    [snapshot],
  );
}
