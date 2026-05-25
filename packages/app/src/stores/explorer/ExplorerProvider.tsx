import type {
  ContainerContentsContextValue,
  ContainerContentsStore,
} from "@tearleads/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";

const ExplorerContext = createContext<ContainerContentsStore | null>(null);

export function ExplorerProvider({ children }: PropsWithChildren) {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const runtime = useMemo(
    () => tearleads.containerContents.runtime(),
    [appData, tearleads],
  );
  const store = useMemo(
    () => tearleads.containerContents.store({ logLabel: "Explorer" }),
    [runtime.domainScope, tearleads],
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

export function useExplorer(): ContainerContentsContextValue {
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
    shareWithGroup: store.shareWithGroup,
    shareWithUser: store.shareWithUser,
    nodes: snapshot.nodes,
    ready: snapshot.ready,
  };
}
