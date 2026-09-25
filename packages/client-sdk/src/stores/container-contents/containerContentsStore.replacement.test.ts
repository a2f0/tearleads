import { expect, mock, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createDomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsStore } from "./containerContentsStore";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
  updateContainerContentsStorePersistence,
} from "./state";
import { createContainerContentsStoreSyncAgent } from "./syncAgent";

function createRuntime(input: {
  execSql: ExecSql;
  domainScope?: ReturnType<typeof createDomainScope>;
}) {
  return createContainerContentsTestRuntime({
    ...input,
    domainScope: input.domainScope ?? createDomainScope(),
    apiClient: createMockApiClient({
      listContainerParentLanes: async (request) => ({
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
    }),
  });
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await Bun.sleep(1);
  }
  throw new Error("condition was not reached");
}

test("executor replacement retries initialization against the new database", async () => {
  type LoadResult = Awaited<
    ReturnType<typeof defaultContainerContentsPersistence.loadContainers>
  >;
  const originalDatabase = await createTestExecSql("reset-original-executor");
  const replacementDatabase = await createTestExecSql(
    "reset-replacement-executor",
  );
  const originalExecSql = originalDatabase.execSql;
  const replacementExecSql = replacementDatabase.execSql;
  try {
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
      domainScope,
      execSql: originalExecSql,
    });
    const replacementRuntime = createRuntime({
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
  } finally {
    await originalDatabase.close();
    await replacementDatabase.close();
  }
});

test("persistence replacement retries an in-flight initialization", async () => {
  type LoadResult = Awaited<
    ReturnType<typeof defaultContainerContentsPersistence.loadContainers>
  >;
  const database = await createTestExecSql("reset-replacement-persistence");
  const execSql = database.execSql;
  try {
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
    const runtime = createRuntime({ execSql });
    const state = createContainerContentsStoreState(
      runtime,
      originalPersistence,
    );
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
  } finally {
    await database.close();
  }
});
