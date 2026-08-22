import { expect, mock, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { createDomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsStore } from "./containerContentsStore";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsStoreRuntime,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";

function createRuntime(input: {
  dbStatus: "idle" | "ready";
  execSql?: ExecSql | undefined;
}): ReturnType<typeof createContainerContentsTestRuntime> {
  return createContainerContentsTestRuntime({
    apiClient: {
      listContainerParentLanes: async (request: {
        lanes: ReadonlyArray<{ laneId: string }>;
      }) => ({
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
    } as unknown as ReturnType<
      typeof createContainerContentsTestRuntime
    >["apiClient"],
    dbStatus: input.dbStatus,
    domainScope: createDomainScope(),
    execSql: input.execSql ?? ((async () => []) as ExecSql),
    signingFingerprint: "signing-fingerprint-1",
  });
}

test("database loss reset clears accepted-echo suppression state", () => {
  const state = createContainerContentsStoreState(
    createRuntime({ dbStatus: "ready" }),
    defaultContainerContentsPersistence,
  );
  const unusedSyncAgent = {} as ContainerContentsStoreSyncAgent;

  // Simulate a store that accepted local metadata updates whose remote echo
  // has not arrived yet, plus a pending sync signal.
  state.initialized = true;
  state.locallyAcceptedMetadataUpdateIds.add("update-1");
  state.metadataDocumentIdsNeedingSync.add("metadata-doc-1");
  state.metadataSyncSignalSeqById.set("metadata-doc-1", 3);

  updateContainerContentsStoreRuntime(
    state,
    createRuntime({ dbStatus: "idle" }),
    unusedSyncAgent,
  );

  // After a database loss the tree rehydrates from remote; retained accepted
  // ids would suppress the next matching remote update signal.
  expect(state.initialized).toBe(false);
  expect(state.locallyAcceptedMetadataUpdateIds.size).toBe(0);
  expect(state.metadataDocumentIdsNeedingSync.size).toBe(0);
  expect(state.metadataSyncSignalSeqById.size).toBe(0);
});

test("database loss invalidates hydration without dropping serialization barriers", () => {
  const state = createContainerContentsStoreState(
    createRuntime({ dbStatus: "ready" }),
    defaultContainerContentsPersistence,
  );
  const unusedSyncAgent = {} as ContainerContentsStoreSyncAgent;
  const activeInitialization = Promise.resolve();
  const activeLocalRefresh = Promise.resolve();
  const activeRemoteHydration = Promise.resolve();
  state.initialized = true;
  state.initializeGeneration = 0;
  state.initializePromise = activeInitialization;
  state.localContainerRefreshGeneration = 0;
  state.localContainerRefreshPromise = activeLocalRefresh;
  state.remoteHydrationGeneration = 0;
  state.remoteHydrationPromise = activeRemoteHydration;

  updateContainerContentsStoreRuntime(
    state,
    createRuntime({ dbStatus: "idle" }),
    unusedSyncAgent,
  );

  expect(state.lifecycleGeneration).toBe(1);
  expect(state.initializePromise).toBe(activeInitialization);
  expect(state.initializeGeneration).toBe(0);
  expect(state.localContainerRefreshPromise).toBe(activeLocalRefresh);
  expect(state.localContainerRefreshGeneration).toBe(0);
  expect(state.remoteHydrationPromise).toBe(activeRemoteHydration);
  expect(state.remoteHydrationGeneration).toBe(0);
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) {
      return;
    }
    await Bun.sleep(1);
  }
  throw new Error("condition was not reached");
}

test("reset serializes replacement initialization behind a stale load", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-initialization-reset-generation",
  );
  try {
    type LoadResult = Awaited<
      ReturnType<typeof defaultContainerContentsPersistence.loadContainers>
    >;
    const resolvers: Array<(value: LoadResult) => void> = [];
    let activeLoads = 0;
    let maxActiveLoads = 0;
    const loadContainers = mock(
      () =>
        new Promise<LoadResult>((resolve) => {
          activeLoads += 1;
          maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
          resolvers.push((value) => {
            activeLoads -= 1;
            resolve(value);
          });
        }),
    );
    const persistence = {
      ...defaultContainerContentsPersistence,
      loadContainers,
    };
    const readyRuntime = createRuntime({ dbStatus: "ready", execSql });
    const idleRuntime = createRuntime({ dbStatus: "idle", execSql });
    const recoveredRuntime = createRuntime({ dbStatus: "ready", execSql });
    const store = createContainerContentsStore(readyRuntime, persistence);

    store.updateRuntime(readyRuntime);
    await waitFor(() => resolvers.length === 1);
    store.updateRuntime(idleRuntime);
    store.updateRuntime(recoveredRuntime);

    expect(loadContainers).toHaveBeenCalledTimes(1);
    resolvers[0]?.([]);
    await waitFor(() => resolvers.length === 2);

    expect(store.getSnapshot()).toEqual({ nodes: [], ready: false });
    resolvers[1]?.([]);
    await waitFor(() => store.getSnapshot().ready);

    expect(maxActiveLoads).toBe(1);
    expect(store.getSnapshot()).toEqual({ nodes: [], ready: true });
  } finally {
    await close();
  }
});

test("recovery initialization waits for a stale local refresh", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-refresh-reset-generation",
  );
  try {
    type LoadResult = Awaited<
      ReturnType<typeof defaultContainerContentsPersistence.loadContainers>
    >;
    const resolvers: Array<(value: LoadResult) => void> = [];
    let activeLoads = 0;
    let maxActiveLoads = 0;
    const loadContainers = mock(
      () =>
        new Promise<LoadResult>((resolve) => {
          activeLoads += 1;
          maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
          resolvers.push((value) => {
            activeLoads -= 1;
            resolve(value);
          });
        }),
    );
    const persistence = {
      ...defaultContainerContentsPersistence,
      loadContainers,
    };
    const readyRuntime = createRuntime({ dbStatus: "ready", execSql });
    const idleRuntime = createRuntime({ dbStatus: "idle", execSql });
    const recoveredRuntime = createRuntime({ dbStatus: "ready", execSql });
    const store = createContainerContentsStore(readyRuntime, persistence);

    store.updateRuntime(readyRuntime);
    await waitFor(() => resolvers.length === 1);
    resolvers[0]?.([]);
    await waitFor(() => store.getSnapshot().ready);

    const staleRefresh = store.refreshLocalContainers();
    await waitFor(() => resolvers.length === 2);
    store.updateRuntime(idleRuntime);
    store.updateRuntime(recoveredRuntime);

    expect(loadContainers).toHaveBeenCalledTimes(2);
    resolvers[1]?.([]);
    await staleRefresh;
    await waitFor(() => resolvers.length === 3);

    expect(store.getSnapshot()).toEqual({ nodes: [], ready: false });
    resolvers[2]?.([]);
    await waitFor(() => store.getSnapshot().ready);

    expect(maxActiveLoads).toBe(1);
  } finally {
    await close();
  }
});
