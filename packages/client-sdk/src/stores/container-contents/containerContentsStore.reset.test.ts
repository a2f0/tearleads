import { expect, mock, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { createDomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createContainerParentSyncLane,
  defaultContainerContentsPersistence,
  markContainerSyncLaneChecked,
} from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsStore } from "./containerContentsStore";
import {
  createContainerContentsTestRuntime,
  seedLocalRootContainer,
} from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
  updateContainerContentsStorePersistence,
  updateContainerContentsStoreRuntime,
} from "./state";
import {
  type ContainerContentsStoreSyncAgent,
  createContainerContentsStoreSyncAgent,
} from "./syncAgent";

function createRuntime(input: {
  dbStatus: "idle" | "ready";
  domainScope?: ReturnType<typeof createDomainScope> | undefined;
  execSql?: ExecSql | undefined;
  isAuthenticated?: boolean | undefined;
  online?: boolean | undefined;
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
    domainScope: input.domainScope ?? createDomainScope(),
    execSql: input.execSql ?? ((async () => []) as ExecSql),
    isAuthenticated: input.isAuthenticated,
    online: input.online,
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

test("executor replacement retries initialization against the new database", async () => {
  type LoadResult = Awaited<
    ReturnType<typeof defaultContainerContentsPersistence.loadContainers>
  >;
  const originalExecSql = mock(async () => []);
  const replacementExecSql = mock(async () => []);
  const loadExecutors: ExecSql[] = [];
  const resolvers: Array<(value: LoadResult) => void> = [];
  const persistence = {
    ...defaultContainerContentsPersistence,
    loadContainers: mock(
      (execSql: ExecSql) =>
        new Promise<LoadResult>((resolve) => {
          loadExecutors.push(execSql);
          resolvers.push(resolve);
        }),
    ),
  };
  const domainScope = createDomainScope();
  const originalRuntime = createRuntime({
    dbStatus: "ready",
    domainScope,
    execSql: originalExecSql,
  });
  const replacementRuntime = createRuntime({
    dbStatus: "ready",
    domainScope,
    execSql: replacementExecSql,
  });
  const store = createContainerContentsStore(originalRuntime, persistence);

  store.updateRuntime(originalRuntime);
  await waitFor(() => resolvers.length === 1);
  store.updateRuntime(replacementRuntime);
  resolvers[0]?.([]);
  await waitFor(() => resolvers.length === 2);

  expect(store.getSnapshot()).toEqual({ nodes: [], ready: false });
  expect(loadExecutors).toEqual([originalExecSql, replacementExecSql]);
  resolvers[1]?.([]);
  await waitFor(() => store.getSnapshot().ready);
});

test("executor replacement prevents an in-flight create from entering the rebuilt tree", async () => {
  const originalDatabase = await createTestExecSql(
    "container-write-reset-original",
  );
  const replacementDatabase = await createTestExecSql(
    "container-write-reset-replacement",
  );
  try {
    await seedLocalRootContainer(originalDatabase.execSql, {
      rootContainerId: "original-root",
    });
    await seedLocalRootContainer(replacementDatabase.execSql, {
      rootContainerId: "replacement-root",
    });
    let releaseSave = () => {};
    let oldExecutorSaveStarted = false;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const persistence = {
      ...defaultContainerContentsPersistence,
      saveContainer: async (
        ...args: Parameters<
          typeof defaultContainerContentsPersistence.saveContainer
        >
      ) => {
        const [execSql, container] = args;
        if (
          execSql === originalDatabase.execSql &&
          container.parentId !== null
        ) {
          oldExecutorSaveStarted = true;
          await saveGate;
        }
        return defaultContainerContentsPersistence.saveContainer(...args);
      },
    };
    const domainScope = createDomainScope();
    const originalRuntime = createRuntime({
      dbStatus: "ready",
      domainScope,
      execSql: originalDatabase.execSql,
    });
    const replacementRuntime = createRuntime({
      dbStatus: "ready",
      domainScope,
      execSql: replacementDatabase.execSql,
    });
    const store = createContainerContentsStore(originalRuntime, persistence);

    store.updateRuntime(originalRuntime);
    await waitFor(() => store.getSnapshot().ready);
    const staleCreate = store.createChild("original-root", "Stale child");
    await waitFor(() => oldExecutorSaveStarted);

    store.updateRuntime(replacementRuntime);
    await waitFor(
      () =>
        store.getSnapshot().ready &&
        store
          .getSnapshot()
          .nodes.some((node) => node.id === "replacement-root"),
    );
    releaseSave();

    await expect(staleCreate).resolves.toBeNull();
    expect(store.getSnapshot().nodes.map((node) => node.id)).toEqual([
      "replacement-root",
    ]);
  } finally {
    await originalDatabase.close();
    await replacementDatabase.close();
  }
});

test("persistence replacement retries an in-flight initialization", async () => {
  type LoadResult = Awaited<
    ReturnType<typeof defaultContainerContentsPersistence.loadContainers>
  >;
  const execSql = mock(async () => []);
  let resolveOriginal: (value: LoadResult) => void = () => {};
  let resolveReplacement: (value: LoadResult) => void = () => {};
  let originalLoadStarted = false;
  let replacementLoadStarted = false;
  const originalPersistence = {
    ...defaultContainerContentsPersistence,
    loadContainers: () =>
      new Promise<LoadResult>((resolve) => {
        originalLoadStarted = true;
        resolveOriginal = resolve;
      }),
  };
  const replacementPersistence = {
    ...defaultContainerContentsPersistence,
    loadContainers: () =>
      new Promise<LoadResult>((resolve) => {
        replacementLoadStarted = true;
        resolveReplacement = resolve;
      }),
  };
  const runtime = createRuntime({ dbStatus: "ready", execSql });
  const state = createContainerContentsStoreState(runtime, originalPersistence);
  const syncAgent = createContainerContentsStoreSyncAgent({
    host: {
      persistContainerState: async () => ({ status: "missing" }),
      updateSnapshot: () => updateContainerContentsSnapshot(state),
    },
    state,
  });

  syncAgent.ensureInitialized();
  await waitFor(() => originalLoadStarted);
  updateContainerContentsStorePersistence(
    state,
    replacementPersistence,
    syncAgent,
  );
  resolveOriginal([]);
  await waitFor(() => replacementLoadStarted);

  expect(state.snapshot).toEqual({ nodes: [], ready: false });
  resolveReplacement([]);
  await waitFor(() => state.snapshot.ready);
  expect(state.persistence).toBe(replacementPersistence);
});

test("initialization observes login while the local load is pending", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-initialization-login-transition",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await markContainerSyncLaneChecked(
      execSql,
      createContainerParentSyncLane(null),
    );
    let resolveLoad: (value: []) => void = () => {};
    let loadStarted = false;
    const persistence = {
      ...defaultContainerContentsPersistence,
      listDormantMetadataSweepRequests: async () => [
        {
          attemptCount: 0,
          generation: 1,
          lastAttemptedAt: null,
          organizationId: "org-1",
          requestedAt: "2026-08-21T00:00:00.000Z",
          requesterUserId: "user-1",
        },
      ],
      loadContainers: () =>
        new Promise<[]>((resolve) => {
          loadStarted = true;
          resolveLoad = resolve;
        }),
    };
    const domainScope = createDomainScope();
    const offlineRuntime = createRuntime({
      dbStatus: "ready",
      domainScope,
      execSql,
      isAuthenticated: false,
      online: false,
    });
    const onlineRuntime = createRuntime({
      dbStatus: "ready",
      domainScope,
      execSql,
      isAuthenticated: true,
      online: true,
    });
    const state = createContainerContentsStoreState(
      offlineRuntime,
      persistence,
    );
    const syncAgent = createContainerContentsStoreSyncAgent({
      host: {
        persistContainerState: async () => {
          throw new Error("the empty startup cache must not persist");
        },
        updateSnapshot: () => updateContainerContentsSnapshot(state),
      },
      state,
    });
    const requestSync = mock(() => {});
    state.syncLane = { requestSync, requestSyncAfter: () => {} };

    syncAgent.ensureInitialized();
    const initialization = state.initializePromise;
    await waitFor(() => loadStarted);
    updateContainerContentsStoreRuntime(state, onlineRuntime, syncAgent);
    resolveLoad([]);
    await initialization;

    expect(state.initialized).toBe(true);
    expect(requestSync).toHaveBeenCalled();
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
