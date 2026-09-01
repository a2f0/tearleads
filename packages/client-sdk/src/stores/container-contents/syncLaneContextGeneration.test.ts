import { expect, mock, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import { createDomainScope } from "../../data/domainScope";
import { createTestContainerState } from "../../workflows/container-contents/container-state/containerState.testFixtures";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
  updateContainerContentsStorePersistence,
  updateContainerContentsStoreRuntime,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";
import { runContainerContentsStoreSyncIteration } from "./syncLaneIteration";

const contextChanges = [
  { containerId: "root-a", name: "organization", organizationId: "org-b" },
  { containerId: "root-b", name: "root container", organizationId: "org-a" },
] as const;

for (const change of contextChanges) {
  test(`a context ${change.name} change abandons an awaited structural pass`, async () => {
    const domainScope = createDomainScope();
    const execSql = mock(async () => []);
    const keyPair = generateKemSeedAndKeyPair();
    const listPendingCreateIntents = mock(async () => []);
    const persistence: ContainerContentsPersistence = {
      ...defaultContainerContentsPersistence,
      listPendingCreateIntents,
    };
    const originalRuntime = createContainerContentsTestRuntime({
      containerId: "root-a",
      domainScope,
      encapsulationKeyPair: keyPair,
      execSql,
      organizationId: "org-a",
    });
    const replacementRuntime = createContainerContentsTestRuntime({
      containerId: change.containerId,
      domainScope,
      encapsulationKeyPair: keyPair,
      execSql,
      organizationId: change.organizationId,
    });
    const state = createContainerContentsStoreState(
      originalRuntime,
      persistence,
    );
    updateContainerContentsSnapshot(state);
    let releaseRestoration: () => void = () => {
      throw new Error("restoration promise was not initialized");
    };
    let restorationStarted = false;

    const iteration = runContainerContentsStoreSyncIteration({
      host: {
        persistContainerState: async () => {
          throw new Error("the stale pass must not persist container state");
        },
        updateSnapshot: () => updateContainerContentsSnapshot(state),
      },
      reconcileRestoredAccess: (isCurrent) => {
        restorationStarted = true;
        return new Promise<void>((resolve) => {
          releaseRestoration = () => {
            expect(isCurrent()).toBe(false);
            resolve();
          };
        });
      },
      requestRemoteReconciliation: () => {},
      state,
    });

    expect(restorationStarted).toBe(true);
    state.runtime = replacementRuntime;
    releaseRestoration();
    await iteration;

    expect(state.lifecycleGeneration).toBe(0);
    expect(listPendingCreateIntents).not.toHaveBeenCalled();
  });
}

test("an event snapshot does not re-arm structural sync", () => {
  const runtime = createContainerContentsTestRuntime({
    domainScope: createDomainScope(),
    execSql: mock(async () => []),
  });
  const state = createContainerContentsStoreState(
    runtime,
    defaultContainerContentsPersistence,
  );
  const scheduleSync = mock(() => {});
  const syncAgent = {
    ensureInitialized: () => {},
    handleRemoteEvents: () => {},
    refreshLocalContainers: async () => {},
    scheduleSync,
  } as unknown as ContainerContentsStoreSyncAgent;

  updateContainerContentsStoreRuntime(
    state,
    {
      ...runtime,
      state: { ...runtime.state, events: [{ type: "ignored" }] },
    },
    syncAgent,
  );

  expect(state.structuralGeneration).toBe(0);
  expect(scheduleSync).not.toHaveBeenCalled();
});

test("executor replacement clears storage-backed state before reinitializing", () => {
  const domainScope = createDomainScope();
  const originalExecSql = mock(async () => []);
  const replacementExecSql = mock(async () => []);
  const originalRuntime = createContainerContentsTestRuntime({
    domainScope,
    execSql: originalExecSql,
  });
  const replacementRuntime = createContainerContentsTestRuntime({
    domainScope,
    execSql: replacementExecSql,
  });
  const state = createContainerContentsStoreState(
    originalRuntime,
    defaultContainerContentsPersistence,
  );
  state.containersById.set(
    "old-database-container",
    createTestContainerState({
      id: "old-database-container",
      parentId: null,
    }),
  );
  state.initialized = true;
  state.lastEventCount = 7;
  state.rootLaneHydrated = true;
  updateContainerContentsSnapshot(state);
  const ensureInitialized = mock(() => {});
  const handleRemoteEvents = mock(() => {});
  const refreshLocalContainers = mock(async () => {});
  const scheduleSync = mock(() => {});
  const syncAgent = {
    ensureInitialized,
    handleRemoteEvents,
    refreshLocalContainers,
    scheduleSync,
  } as unknown as ContainerContentsStoreSyncAgent;

  updateContainerContentsStoreRuntime(state, replacementRuntime, syncAgent);

  expect(state.containersById.size).toBe(0);
  expect(state.rootLaneHydrated).toBe(false);
  expect(state.lastEventCount).toBe(0);
  expect(state.snapshot).toEqual({ nodes: [], ready: false });
  expect(ensureInitialized).toHaveBeenCalledTimes(1);
  expect(handleRemoteEvents).toHaveBeenCalledTimes(1);
  expect(refreshLocalContainers).not.toHaveBeenCalled();
  expect(scheduleSync).not.toHaveBeenCalled();
});

test("runtime ABA replacement invalidates and re-arms a structural pass", async () => {
  const domainScope = createDomainScope();
  const execSql = mock(async () => []);
  const keyPair = generateKemSeedAndKeyPair();
  const listPendingCreateIntents = mock(async () => []);
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    listPendingCreateIntents,
  };
  const runtimeA = createContainerContentsTestRuntime({
    apiClient: {} as never,
    containerId: "root-a",
    domainScope,
    encapsulationKeyPair: keyPair,
    execSql,
    organizationId: "org-a",
  });
  const runtimeB = createContainerContentsTestRuntime({
    apiClient: { replacement: true } as never,
    containerId: "root-a",
    domainScope,
    encapsulationKeyPair: keyPair,
    execSql,
    organizationId: "org-a",
  });
  const state = createContainerContentsStoreState(runtimeA, persistence);
  updateContainerContentsSnapshot(state);
  const scheduleSync = mock(() => {});
  const syncAgent = {
    ensureInitialized: () => {},
    handleRemoteEvents: () => {},
    refreshLocalContainers: async () => {},
    scheduleSync,
  } as unknown as ContainerContentsStoreSyncAgent;
  let releaseRestoration: () => void = () => {
    throw new Error("restoration promise was not initialized");
  };

  const iteration = runContainerContentsStoreSyncIteration({
    host: {
      persistContainerState: async () => {
        throw new Error("the stale pass must not persist container state");
      },
      updateSnapshot: () => updateContainerContentsSnapshot(state),
    },
    reconcileRestoredAccess: (isCurrent) =>
      new Promise<void>((resolve) => {
        releaseRestoration = () => {
          expect(isCurrent()).toBe(false);
          resolve();
        };
      }),
    requestRemoteReconciliation: () => {},
    state,
  });

  updateContainerContentsStoreRuntime(state, runtimeB, syncAgent);
  updateContainerContentsStoreRuntime(state, runtimeA, syncAgent);
  releaseRestoration();
  await iteration;

  expect(state.runtime).toBe(runtimeA);
  expect(state.structuralGeneration).toBe(2);
  expect(scheduleSync).toHaveBeenCalledTimes(2);
  expect(listPendingCreateIntents).not.toHaveBeenCalled();
});

test("persistence ABA replacement invalidates and re-arms a structural pass", async () => {
  const domainScope = createDomainScope();
  const execSql = mock(async () => []);
  const keyPair = generateKemSeedAndKeyPair();
  const listPendingCreateIntents = mock(async () => []);
  const persistenceA: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    listPendingCreateIntents,
  };
  const persistenceB: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
  };
  const runtime = createContainerContentsTestRuntime({
    domainScope,
    encapsulationKeyPair: keyPair,
    execSql,
  });
  const state = createContainerContentsStoreState(runtime, persistenceA);
  state.initialized = true;
  state.lastEventCount = 5;
  state.rootLaneHydrated = true;
  updateContainerContentsSnapshot(state);
  const scheduleSync = mock(() => {});
  const ensureInitialized = mock(() => {});
  const syncAgent = {
    ensureInitialized,
    scheduleSync,
  } as unknown as ContainerContentsStoreSyncAgent;
  let releaseRestoration: () => void = () => {
    throw new Error("restoration promise was not initialized");
  };

  const iteration = runContainerContentsStoreSyncIteration({
    host: {
      persistContainerState: async () => {
        throw new Error("the stale pass must not persist container state");
      },
      updateSnapshot: () => updateContainerContentsSnapshot(state),
    },
    reconcileRestoredAccess: (isCurrent) =>
      new Promise<void>((resolve) => {
        releaseRestoration = () => {
          expect(isCurrent()).toBe(false);
          resolve();
        };
      }),
    requestRemoteReconciliation: () => {},
    state,
  });

  updateContainerContentsStorePersistence(state, persistenceB, syncAgent);
  updateContainerContentsStorePersistence(state, persistenceA, syncAgent);
  releaseRestoration();
  await iteration;

  expect(state.persistence).toBe(persistenceA);
  expect(state.structuralGeneration).toBe(2);
  expect(state.lastEventCount).toBe(0);
  expect(ensureInitialized).toHaveBeenCalledTimes(2);
  expect(scheduleSync).not.toHaveBeenCalled();
  expect(state.snapshot).toEqual({ nodes: [], ready: false });
  expect(listPendingCreateIntents).not.toHaveBeenCalled();
});

test("the sync lane preserves metadata edits already settled by the workflow", async () => {
  const keyPair = generateKemSeedAndKeyPair();
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    listPendingCreateIntents: async () => [],
    listUnsyncedMoveIntents: async () => [],
  };
  const runtime = createContainerContentsTestRuntime({
    domainScope: createDomainScope(),
    encapsulationKeyPair: keyPair,
    execSql: mock(async () => []),
    organizationId: "org-1",
  });
  const state = createContainerContentsStoreState(runtime, persistence);
  const containerState = createTestContainerState({
    id: "container-1",
    organizationId: "org-1",
    parentId: null,
  });
  state.containersById.set(containerState.container.id, containerState);
  state.documentStoresNeedPriming = false;
  updateContainerContentsSnapshot(state);
  const updateSnapshot = mock(() => updateContainerContentsSnapshot(state));
  const syncContainerMetadata = mock(
    async ({ metadataState }: { metadataState: typeof containerState }) => {
      const staleContainer = {
        ...metadataState.container,
        name: "Remote result before the local edit",
      };
      const staleRecord = { ...metadataState.record, lastCommitLsn: "0/2" };
      metadataState.container = {
        ...metadataState.container,
        name: "Concurrent local edit",
      };
      metadataState.record = {
        ...metadataState.record,
        lastCommitLsn: "0/3",
      };
      return {
        container: staleContainer,
        record: staleRecord,
        shouldRequestFollowupSync: false,
      };
    },
  );

  await runContainerContentsStoreSyncIteration({
    host: {
      persistContainerState: async () => ({ status: "missing" }),
      updateSnapshot,
    },
    reconcileRestoredAccess: async () => {},
    requestRemoteReconciliation: () => {},
    state,
    syncContainerMetadata: syncContainerMetadata as never,
  });

  expect(syncContainerMetadata).toHaveBeenCalledTimes(1);
  expect(containerState.container.name).toBe("Concurrent local edit");
  expect(containerState.record.lastCommitLsn).toBe("0/3");
  expect(updateSnapshot).toHaveBeenCalled();
});
