import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createGenerationGuardedHydrationHost,
  type RemoteContainerHydrationHost,
  StaleRemoteHydrationError,
} from "../../workflows/container-contents/remoteHydration";
import {
  requestContainerContentsRemoteHydration,
  resumeContainerContentsRecoveryHydration,
} from "./remoteHydrationRequest";

type RequestState = Parameters<
  typeof requestContainerContentsRemoteHydration
>[0]["state"];
type ListParentLanes =
  RequestState["runtime"]["apiClient"]["listContainerParentLanes"];
type LaneResponse = Awaited<ReturnType<ListParentLanes>>;

const laneResponse: LaneResponse = {
  results: [
    {
      laneId: "lane-0",
      page: {
        hasMore: false,
        items: [],
        nextWatermark: null,
        tombstones: [],
      },
    },
  ],
};

test("structural generation guards the hydration persistence transaction", async () => {
  let current = true;
  let transactionalGuard: (() => boolean) | undefined;
  const host: RemoteContainerHydrationHost = {
    persistContainerState: async (
      _containerState,
      _patch,
      _updateView,
      _saveOptions,
      mutationOptions,
    ) => {
      transactionalGuard = mutationOptions?.isCurrent;
      expect(transactionalGuard?.()).toBe(true);
      current = false;
      expect(transactionalGuard?.()).toBe(false);
      return { status: "stale-generation" };
    },
    updateSnapshot: () => {},
  };
  const guardedHost = createGenerationGuardedHydrationHost({
    host,
    isCurrent: () => current,
  });

  await expect(
    guardedHost.persistContainerState(
      {} as Parameters<
        RemoteContainerHydrationHost["persistContainerState"]
      >[0],
    ),
  ).rejects.toBeInstanceOf(StaleRemoteHydrationError);
  expect(transactionalGuard).toBeDefined();
});

test("structural replacement retries hydration in the current generation", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-structural-hydration-generation",
  );
  try {
    let resolveStaleRequest: (value: LaneResponse) => void = () => {
      throw new Error("stale hydration request was not initialized");
    };
    let requestCount = 0;
    const listContainerParentLanes: ListParentLanes = () => {
      requestCount += 1;
      if (requestCount > 1) return Promise.resolve(laneResponse);
      return new Promise<LaneResponse>((resolve) => {
        resolveStaleRequest = resolve;
      });
    };
    const state = {
      containerParentIdsNeedingHydration: new Set<string | null>(),
      containersById: new Map(),
      initializePromise: null,
      initialized: true,
      lifecycleGeneration: 0,
      localContainerRefreshGeneration: null,
      localContainerRefreshPromise: null,
      localContainerRefreshStructuralGeneration: null,
      localContainersNeedRefresh: false,
      persistence: { loadContainerHydrationTombstones: async () => [] },
      remoteHydrationPromise: null,
      remoteHydrationGeneration: null,
      remoteHydrationStructuralGeneration: null,
      rootLaneHydrated: false,
      runtime: {
        apiClient: { listContainerParentLanes },
        auth: { isAuthenticated: true },
        infra: { dbStatus: "ready", execSql },
        state: { online: true },
        util: { log: () => {} },
      },
      snapshot: { ready: true },
      structuralGeneration: 0,
    } as unknown as RequestState;
    const host = {
      persistContainerState: async () => {
        throw new Error("empty root hydration cannot persist a container");
      },
      updateSnapshot: () => {},
    } as RemoteContainerHydrationHost;
    let staleCompletionCount = 0;

    const hydration = requestContainerContentsRemoteHydration({
      host,
      onFullyHydrated: () => {
        staleCompletionCount += 1;
      },
      parentIds: [null],
      resumeRecoveryWork: async () => {
        await resumeContainerContentsRecoveryHydration(state);
      },
      scheduleSync: () => {},
      state,
    });
    for (let attempt = 0; requestCount === 0; attempt += 1) {
      if (attempt === 100) throw new Error("stale hydration did not start");
      await Bun.sleep(1);
    }

    state.structuralGeneration += 1;
    resolveStaleRequest(laneResponse);
    await hydration;

    expect(requestCount).toBe(2);
    expect(staleCompletionCount).toBe(0);
    expect(state.rootLaneHydrated).toBe(true);
    expect(state.remoteHydrationPromise).toBeNull();
  } finally {
    close();
  }
});
