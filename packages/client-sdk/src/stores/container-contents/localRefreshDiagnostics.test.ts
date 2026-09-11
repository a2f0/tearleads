import { expect, test } from "bun:test";
import { Tearleads } from "../../client/Tearleads";
import { DatabaseUnavailableError } from "../../data/sync/databaseUnavailable";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { ContainerStateMap } from "./containerStateMap";
import {
  type LocalContainerRefreshState,
  refreshLocalContainerStates,
} from "./localRefresh";

const LOCAL_LOG_PREFIX = "Failed to refresh local container states: ";

function createRecordingSdk(input: {
  logMessages: string[];
  loggerResult: "reject" | "success" | "throw";
  reported: unknown[];
}): Tearleads {
  return new Tearleads({
    logger: {
      log: (message) => input.logMessages.push(message),
      logError: (_message, error) => {
        input.reported.push(error);
        if (input.loggerResult === "throw")
          throw new Error("Diagnostic transport unavailable");
        if (input.loggerResult === "reject")
          return Promise.reject(new Error("Diagnostic transport unavailable"));
        return undefined;
      },
    },
  });
}

function createRefreshState(input: {
  loadContainers: ContainerContentsPersistence["loadContainers"];
  sdk: Tearleads;
}): LocalContainerRefreshState {
  const runtime = input.sdk.containerContents.workflowRuntime();
  return {
    containersById: new ContainerStateMap(),
    documentStoresNeedPriming: false,
    initialized: true,
    lifecycleGeneration: 0,
    localContainerRefreshGeneration: null,
    localContainerRefreshPromise: null,
    localContainerRefreshStructuralGeneration: null,
    localContainersNeedRefresh: true,
    persistence: {
      ensureSchema: async () => {},
      loadContainers: input.loadContainers,
    } as unknown as ContainerContentsPersistence,
    // The host database never opens here: the stubbed load is the failure under
    // test, so only the refresh gate needs a ready status.
    runtime: { ...runtime, infra: { ...runtime.infra, dbStatus: "ready" } },
    structuralGeneration: 0,
  };
}

async function refreshAfterFailedLoad(input: {
  failure: unknown;
  logMessages: string[];
  loggerResult: "reject" | "success" | "throw";
  reported: unknown[];
}): Promise<LocalContainerRefreshState> {
  const sdk = createRecordingSdk(input);
  try {
    const state = createRefreshState({
      loadContainers: async () => {
        throw input.failure;
      },
      sdk,
    });
    await expect(
      refreshLocalContainerStates({
        host: { updateSnapshot: () => {} },
        state,
      }),
    ).resolves.toBeUndefined();
    return state;
  } finally {
    sdk.dispose();
  }
}

for (const loggerResult of ["success", "throw", "reject"] as const) {
  test(`a failed tree rebuild reaches the SDK logger: ${loggerResult}`, async () => {
    const failure = new Error("corrupt persisted container metadata");
    const logMessages: string[] = [];
    const reported: unknown[] = [];

    const state = await refreshAfterFailedLoad({
      failure,
      logMessages,
      loggerResult,
      reported,
    });

    expect(reported).toEqual([failure]);
    expect(logMessages).toEqual([`${LOCAL_LOG_PREFIX}${failure.message}`]);
    // A host logger that throws or rejects must not disarm the retry.
    expect(state.localContainersNeedRefresh).toBe(true);
    expect(state.localContainerRefreshPromise).toBeNull();
  });
}

test("a database lost mid-refresh is logged locally but not reported", async () => {
  const failure = new DatabaseUnavailableError("DB has been closed.");
  const logMessages: string[] = [];
  const reported: unknown[] = [];

  await refreshAfterFailedLoad({
    failure,
    logMessages,
    loggerResult: "success",
    reported,
  });

  expect(reported).toEqual([]);
  expect(logMessages).toEqual([`${LOCAL_LOG_PREFIX}${failure.message}`]);
});

test("a failure from an invalidated generation is neither logged nor reported", async () => {
  const logMessages: string[] = [];
  const reported: unknown[] = [];
  const sdk = createRecordingSdk({
    logMessages,
    loggerResult: "success",
    reported,
  });
  try {
    const started = Promise.withResolvers<void>();
    const staleLoad = Promise.withResolvers<never>();
    let loads = 0;
    const state = createRefreshState({
      loadContainers: () => {
        loads += 1;
        // The teardown's replacement pass must still settle, or the awaited
        // retry chained in `finally` would never resolve.
        if (loads > 1) return Promise.resolve([]);
        started.resolve();
        return staleLoad.promise;
      },
      sdk,
    });

    const refresh = refreshLocalContainerStates({
      host: { updateSnapshot: () => {} },
      state,
    });
    // Invalidate the generation only once the load is in flight: that ordering
    // is the race under test.
    await started.promise;
    state.lifecycleGeneration += 1;
    staleLoad.reject(new Error("database closed during identity teardown"));
    await refresh;

    expect(reported).toEqual([]);
    expect(logMessages).toEqual([]);
  } finally {
    sdk.dispose();
  }
});
