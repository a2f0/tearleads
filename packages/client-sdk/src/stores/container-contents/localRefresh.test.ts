import { expect, mock, test } from "bun:test";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";
import {
  type LocalContainerRefreshState,
  refreshLocalContainerStates,
} from "./localRefresh";

function createRefreshState(input: {
  loadContainers: ContainerContentsPersistence["loadContainers"];
  log?: (message: string) => void;
}): LocalContainerRefreshState {
  return {
    containersById: new Map(),
    documentStoresNeedPriming: false,
    initialized: true,
    localContainerRefreshPromise: null,
    localContainersNeedRefresh: true,
    persistence: {
      ensureSchema: async () => {},
      loadContainers: input.loadContainers,
    } as unknown as ContainerContentsPersistence,
    runtime: {
      infra: {
        dbStatus: "ready",
        execSql: {} as ContainerContentsWorkflowRuntime["infra"]["execSql"],
      },
      util: {
        log: input.log ?? (() => {}),
      },
    } as ContainerContentsWorkflowRuntime,
  };
}

test("local container refresh waits for an in-flight refresh", async () => {
  type LoadContainersResult = Awaited<
    ReturnType<ContainerContentsPersistence["loadContainers"]>
  >;
  let resolveLoad: (value: LoadContainersResult) => void = () => {
    throw new Error("loadContainers promise was not initialized");
  };
  const loadContainers = mock(
    () =>
      new Promise<LoadContainersResult>((resolve) => {
        resolveLoad = resolve;
      }),
  );
  const state = createRefreshState({ loadContainers });
  const host = { updateSnapshot: mock(() => {}) };

  const firstRefresh = refreshLocalContainerStates({ host, state });
  const secondRefresh = refreshLocalContainerStates({ host, state });

  expect(secondRefresh).toBe(firstRefresh);
  await Promise.resolve();
  expect(loadContainers).toHaveBeenCalledTimes(1);
  resolveLoad([]);
  await Promise.all([firstRefresh, secondRefresh]);

  expect(host.updateSnapshot).toHaveBeenCalledTimes(1);
});

test("local container refresh logs failures without rejecting", async () => {
  const logMessages: string[] = [];
  const state = createRefreshState({
    loadContainers: async () => {
      throw new Error("database closed");
    },
    log: (message) => logMessages.push(message),
  });

  await expect(
    refreshLocalContainerStates({
      host: { updateSnapshot: () => {} },
      state,
    }),
  ).resolves.toBeUndefined();

  expect(logMessages[0]).toContain(
    "Failed to refresh local container states: database closed",
  );
  expect(state.localContainersNeedRefresh).toBe(true);
});
