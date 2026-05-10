import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useAppData } from "../../providers/data/AppDataProvider";
import {
  createExplorerWorkflowRuntime,
  defaultExplorerPersistence,
  type ExplorerPersistence,
} from "../../workflows/explorer";
import {
  createExplorerSyncAgent,
  type ExplorerRuntime,
} from "./explorerSyncAgent";
import {
  createChildContainer,
  deleteExplorerContainer,
  moveExplorerContainer,
  persistContainerState,
  renameExplorerContainer,
  shareExplorerContainerWithUser,
} from "./operations";
import {
  createExplorerStoreState,
  subscribeToExplorerStore,
  updateExplorerSnapshot,
  updateExplorerStoreRuntime,
} from "./state";
import type { ExplorerContextValue, ExplorerStore } from "./types";

const explorerStoresByScope = new WeakMap<object, ExplorerStore>();
const ExplorerContext = createContext<ExplorerStore | null>(null);

export function createExplorerStore(
  initialRuntime: ExplorerRuntime,
  persistence: ExplorerPersistence = defaultExplorerPersistence,
): ExplorerStore {
  const state = createExplorerStoreState(initialRuntime, persistence);
  const syncAgent = createExplorerSyncAgent({
    host: {
      persistContainerState: (containerState, patch, updateView) =>
        persistContainerState(state, containerState, patch, updateView),
      updateSnapshot: () => updateExplorerSnapshot(state),
    },
    state,
  });

  return {
    createChild: (parentId: string, name: string) => {
      state.writeChain = state.writeChain
        .catch(() => null)
        .then(() => createChildContainer(state, syncAgent, parentId, name));
      return state.writeChain;
    },
    deleteContainer: (containerId: string) => {
      state.writeChain = state.writeChain
        .catch(() => null)
        .then(() => deleteExplorerContainer(state, containerId));
      return state.writeChain.then((deletedNode) => deletedNode !== null);
    },
    moveContainer: (containerId: string, parentId: string) => {
      state.writeChain = state.writeChain
        .catch(() => null)
        .then(() =>
          moveExplorerContainer(state, syncAgent, containerId, parentId),
        );
      return state.writeChain;
    },
    refresh: () => syncAgent.refresh(),
    renameContainer: (containerId: string, name: string) => {
      state.writeChain = state.writeChain
        .catch(() => null)
        .then(() =>
          renameExplorerContainer(state, syncAgent, containerId, name),
        );
      return state.writeChain;
    },
    shareWithUser: (containerId: string, userId: string) => {
      state.writeChain = state.writeChain
        .catch(() => null)
        .then(() =>
          shareExplorerContainerWithUser(state, syncAgent, containerId, userId),
        );
      return state.writeChain.then((sharedNode) => sharedNode !== null);
    },
    getSnapshot: () => state.snapshot,
    subscribe: (listener) => subscribeToExplorerStore(state, listener),
    updateRuntime: (runtime) =>
      updateExplorerStoreRuntime(state, runtime, syncAgent),
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
  const appData = useAppData();
  const runtime = useMemo(
    () => createExplorerWorkflowRuntime(appData),
    [appData],
  );
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

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return {
    createChild: store.createChild,
    deleteContainer: store.deleteContainer,
    moveContainer: store.moveContainer,
    refresh: store.refresh,
    renameContainer: store.renameContainer,
    shareWithUser: store.shareWithUser,
    nodes: snapshot.nodes,
    ready: snapshot.ready,
  };
}
