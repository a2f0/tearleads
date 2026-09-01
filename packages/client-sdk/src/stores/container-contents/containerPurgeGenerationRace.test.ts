import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { createContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createTestContainerState } from "../../workflows/container-contents/container-state/containerState.testFixtures";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import {
  refreshAfterStalePurge,
  runContainerPurge,
} from "./containerPurgeCore";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
  updateContainerContentsStoreRuntime,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";

test("zero-completion stale teardown still refreshes and re-primes", async () => {
  const state = createContainerContentsStoreState(
    createContainerContentsTestRuntime({
      domainScope: {} as DomainScope,
      execSql: (async () => []) as ExecSql,
    }),
    defaultContainerContentsPersistence,
  );
  state.documentStoresNeedPriming = false;
  let refreshes = 0;

  await refreshAfterStalePurge({
    completedCount: 0,
    containerStatesAtStart: new Map(),
    purgedContainerIds: [],
    state,
    syncAgent: {
      refreshLocalContainers: async () => {
        refreshes += 1;
      },
    } as unknown as ContainerContentsStoreSyncAgent,
  });

  expect(refreshes).toBe(1);
  expect(state.localContainersNeedRefresh).toBe(true);
  expect(state.documentStoresNeedPriming).toBe(true);
});

test("a partial purge refreshes current state after generation rollover", async () => {
  const database = await createTestExecSql("container-purge-generation-race");
  try {
    const container: ContainerState = {
      container: {
        effectiveAccessLevel: "admin",
        icon: null,
        id: "purged-container",
        metadataDocumentId: null,
        name: "Purged",
        organizationId: "org-1",
        parentId: "parent",
        systemSlot: null,
      },
      doc: await createContainerMetadataDocument("purged-container"),
      record: {
        accessEpoch: 0,
        accessStateHash: null,
        contentKeyBundle: null,
        documentId: null,
        documentKekTargets: null,
        documentManifestBundle: null,
        id: "purged-container",
        lastCommitLsn: null,
        metadataUpdates: "",
        snapshotEndVersion: "",
      },
    };
    await defaultContainerContentsPersistence.ensureSchema(database.execSql);
    await defaultContainerContentsPersistence.saveContainer(
      database.execSql,
      container.container,
      container.record,
    );
    let current = true;
    const persistence: ContainerContentsPersistence = {
      ...defaultContainerContentsPersistence,
      deleteContainer: async (...args) => {
        await defaultContainerContentsPersistence.deleteContainer(...args);
        current = false;
      },
    };
    const state = createContainerContentsStoreState(
      createContainerContentsTestRuntime({
        domainScope: {} as DomainScope,
        execSql: database.execSql,
        online: false,
      }),
      persistence,
    );
    state.containersById.set(container.container.id, container);
    state.initialized = true;
    updateContainerContentsSnapshot(state);
    let refreshes = 0;
    const syncAgent = {
      refreshLocalContainers: async () => {
        refreshes += 1;
        state.initialized = false;
        state.snapshot = { nodes: [], ready: false };
      },
    } as unknown as ContainerContentsStoreSyncAgent;

    expect(
      await runContainerPurge(
        state,
        syncAgent,
        container.container.id,
        undefined,
        () => current,
        {
          describeResult: () => "purged",
          didSucceed: () => true,
          validateTarget: () => true,
        },
      ),
    ).toBe(false);
    expect(refreshes).toBe(1);
    expect(state.localContainersNeedRefresh).toBe(true);
    expect(state.containersById.has(container.container.id)).toBe(false);
    expect(state.snapshot.nodes.map((node) => node.id)).not.toContain(
      container.container.id,
    );
    expect(state.snapshot.ready).toBe(false);
    expect(state.documentStoresNeedPriming).toBe(true);
    expect(
      await defaultContainerContentsPersistence.loadContainerMetadataState(
        database.execSql,
        container.container.id,
      ),
    ).toBeNull();
  } finally {
    database.close();
  }
});

test("stale remote purge reconciliation targets the replacement executor", async () => {
  const originalDatabase = await createTestExecSql(
    "container-purge-original-executor",
  );
  const replacementDatabase = await createTestExecSql(
    "container-purge-replacement-executor",
  );
  const container = createTestContainerState({
    id: "purged-container",
    organizationId: "org-1",
    parentId: "parent",
  });

  try {
    for (const execSql of [
      originalDatabase.execSql,
      replacementDatabase.execSql,
    ]) {
      await defaultContainerContentsPersistence.ensureSchema(execSql);
      await defaultContainerContentsPersistence.saveContainer(
        execSql,
        container.container,
        container.record,
      );
    }
    const domainScope = {} as DomainScope;
    const originalRuntime = createContainerContentsTestRuntime({
      domainScope,
      execSql: originalDatabase.execSql,
    });
    const replacementRuntime = createContainerContentsTestRuntime({
      domainScope,
      execSql: replacementDatabase.execSql,
    });
    const state = createContainerContentsStoreState(
      originalRuntime,
      defaultContainerContentsPersistence,
    );
    state.containersById.set(container.container.id, container);
    state.initialized = true;
    updateContainerContentsSnapshot(state);
    const hydrationRequests: Array<{
      followDiscoveredParentLanes?: boolean | undefined;
      parentIds?: ReadonlyArray<string | null> | undefined;
      resetAllLaneWatermarks?: boolean | undefined;
    }> = [];
    const syncAgent = {
      ensureInitialized: () => undefined,
      handleRemoteEvents: () => undefined,
      refreshLocalContainers: async () => undefined,
      requestRemoteHydration: async (options = {}) => {
        hydrationRequests.push(options);
        await defaultContainerContentsPersistence.deleteContainer(
          state.runtime.infra.execSql,
          container.container.id,
          { updatedAt: "2026-08-31T00:00:00.000Z" },
        );
      },
      scheduleSync: () => undefined,
    } as unknown as ContainerContentsStoreSyncAgent;
    const containerStatesAtStart = new Map(state.containersById);

    await defaultContainerContentsPersistence.deleteContainer(
      originalDatabase.execSql,
      container.container.id,
      { updatedAt: "2026-08-31T00:00:00.000Z" },
    );
    updateContainerContentsStoreRuntime(state, replacementRuntime, syncAgent);
    await refreshAfterStalePurge({
      completedCount: 1,
      containerStatesAtStart,
      purgedContainerIds: [container.container.id],
      state,
      syncAgent,
    });

    expect(hydrationRequests).toEqual([
      {
        followDiscoveredParentLanes: false,
        parentIds: [container.container.parentId],
        resetAllLaneWatermarks: true,
      },
    ]);
    expect(
      await defaultContainerContentsPersistence.containerExists(
        originalDatabase.execSql,
        container.container.id,
      ),
    ).toBe(false);
    expect(
      await defaultContainerContentsPersistence.containerExists(
        replacementDatabase.execSql,
        container.container.id,
      ),
    ).toBe(false);
  } finally {
    await originalDatabase.close();
    await replacementDatabase.close();
  }
});
