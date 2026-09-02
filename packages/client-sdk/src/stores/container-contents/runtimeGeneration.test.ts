import { expect, mock, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { createDomainScope } from "../../data/domainScope";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
  updateContainerContentsStoreRuntime,
} from "./state";
import {
  type ContainerContentsStoreSyncAgent,
  createContainerContentsStoreSyncAgent,
} from "./syncAgent";
import { captureContainerWriteGeneration } from "./writeGeneration";

function syncAgentDouble(
  overrides: { refresh?: () => Promise<boolean> } = {},
): ContainerContentsStoreSyncAgent {
  return {
    ensureInitialized: () => {},
    handleRemoteEvents: () => {},
    refresh: overrides.refresh ?? (async () => true),
    refreshLocalContainers: async () => {},
    scheduleSync: () => {},
  } as unknown as ContainerContentsStoreSyncAgent;
}

test("runtime ABA invalidates an in-flight container write", () => {
  const domainScope = createDomainScope();
  const execSql = mock(async () => []);
  const runtimeA = createContainerContentsTestRuntime({
    apiClient: { runtime: "a" } as never,
    domainScope,
    execSql,
  });
  const runtimeB = createContainerContentsTestRuntime({
    apiClient: { runtime: "b" } as never,
    domainScope,
    execSql,
  });
  const state = createContainerContentsStoreState(
    runtimeA,
    defaultContainerContentsPersistence,
  );
  const isCurrent = captureContainerWriteGeneration(state);
  const syncAgent = syncAgentDouble();

  updateContainerContentsStoreRuntime(state, runtimeB, syncAgent);
  updateContainerContentsStoreRuntime(state, runtimeA, syncAgent);

  expect(state.writeGeneration).toBe(2);
  expect(isCurrent()).toBe(false);
});

test("server event reconnection forces remote lane reconciliation", () => {
  const runtime = createContainerContentsTestRuntime({
    domainScope: createDomainScope(),
    execSql: mock(async () => []),
  });
  const state = createContainerContentsStoreState(
    runtime,
    defaultContainerContentsPersistence,
  );
  state.initialized = true;
  updateContainerContentsSnapshot(state);
  const refresh = mock(async () => true);

  updateContainerContentsStoreRuntime(
    state,
    {
      ...runtime,
      state: {
        ...runtime.state,
        serverEventsConnectionGeneration:
          (runtime.state.serverEventsConnectionGeneration ?? 0) + 1,
      },
    },
    syncAgentDouble({ refresh }),
  );

  expect(refresh).toHaveBeenCalledTimes(1);
});

test("reconnect during initialization retains a full remote relist", async () => {
  type LoadResult = Awaited<
    ReturnType<typeof defaultContainerContentsPersistence.loadContainers>
  >;
  const execSql = mock(async () => []);
  let loadCalls = 0;
  let loadStarted = false;
  let resolveLoad: (containers: LoadResult) => void = () => {
    throw new Error("container load was not initialized");
  };
  const persistence = {
    ...defaultContainerContentsPersistence,
    loadContainers: () => {
      loadCalls += 1;
      if (loadCalls > 1) return Promise.resolve([]);
      return new Promise<LoadResult>((resolve) => {
        loadStarted = true;
        resolveLoad = resolve;
      });
    },
  };
  const listContainerParentLanes = mock(
    async (request: { lanes: ReadonlyArray<{ laneId: string }> }) => ({
      results: request.lanes.map(({ laneId }) => ({
        laneId,
        page: {
          hasMore: false,
          items: [],
          nextWatermark: null,
          tombstones: [],
        },
      })),
    }),
  );
  const runtime = createContainerContentsTestRuntime({
    apiClient: { listContainerParentLanes } as never,
    domainScope: createDomainScope(),
    execSql,
  });
  const state = createContainerContentsStoreState(runtime, persistence);
  const syncAgent = createContainerContentsStoreSyncAgent({
    host: {
      persistContainerState: async () => {
        throw new Error("empty relist must not persist a container");
      },
      updateSnapshot: () => updateContainerContentsSnapshot(state),
    },
    state,
  });

  syncAgent.ensureInitialized();
  await waitFor(() => loadStarted, "container initialization did not start");
  const initialization = state.initializePromise;
  updateContainerContentsStoreRuntime(
    state,
    {
      ...runtime,
      state: { ...runtime.state, serverEventsConnectionGeneration: 1 },
    },
    syncAgent,
  );
  expect(state.remoteReconnectRefreshPending).toBe(true);
  expect(listContainerParentLanes).not.toHaveBeenCalled();

  resolveLoad([]);
  await initialization;
  await waitFor(
    () => listContainerParentLanes.mock.calls.length === 1,
    "reconnect relist did not run after initialization",
  );
  expect(state.remoteReconnectRefreshPending).toBe(false);
});
