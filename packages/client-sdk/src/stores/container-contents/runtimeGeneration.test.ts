import { expect, mock, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
  updateContainerContentsStoreRuntime,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";
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
