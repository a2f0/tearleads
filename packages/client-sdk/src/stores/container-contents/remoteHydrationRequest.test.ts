import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { RemoteContainerHydrationHost } from "../../workflows/container-contents/remoteHydration";
import { requestContainerContentsRemoteHydration } from "./remoteHydrationRequest";

type RequestState = Parameters<
  typeof requestContainerContentsRemoteHydration
>[0]["state"];
type ListParentLanes =
  RequestState["runtime"]["apiClient"]["listContainerParentLanes"];

function createRequestState(
  execSql: ExecSql,
  listContainerParentLanes?: ListParentLanes,
): RequestState {
  return {
    containerParentIdsNeedingHydration: new Set<string | null>(),
    containersById: new Map(),
    initializePromise: null,
    initialized: true,
    lifecycleGeneration: 0,
    localContainerRefreshGeneration: null,
    localContainerRefreshPromise: null,
    localContainersNeedRefresh: false,
    persistence: {},
    remoteHydrationPromise: null,
    remoteHydrationGeneration: null,
    rootLaneHydrated: false,
    runtime: {
      apiClient: {
        listContainerParentLanes:
          listContainerParentLanes ??
          (async () => ({
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
          })),
      },
      auth: { isAuthenticated: true },
      infra: { dbStatus: "ready", execSql },
      state: { online: true },
      util: { log: () => {} },
    },
    snapshot: { ready: true },
  } as unknown as RequestState;
}

const emptyHydrationHost = {
  persistContainerState: async () => {
    throw new Error("empty root hydration cannot persist a container");
  },
  updateSnapshot: () => {},
} as RemoteContainerHydrationHost;

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) {
      return;
    }
    await Bun.sleep(1);
  }
  throw new Error("condition was not reached");
}

test("first completed root hydration schedules recovery with no remote delta", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-root-lane-hydration-schedule",
  );
  try {
    let scheduledCount = 0;
    const state = createRequestState(execSql);

    await requestContainerContentsRemoteHydration({
      host: emptyHydrationHost,
      parentIds: [null],
      scheduleSync: () => {
        scheduledCount += 1;
      },
      state,
    });

    expect(state.rootLaneHydrated).toBe(true);
    expect(scheduledCount).toBe(1);
  } finally {
    close();
  }
});

test("restoration hydration can suppress change-driven lane rearming", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-restoration-hydration-no-rearm",
  );
  try {
    let scheduledCount = 0;
    const state = createRequestState(execSql);

    await requestContainerContentsRemoteHydration({
      host: emptyHydrationHost,
      parentIds: [null],
      scheduleSync: () => {
        scheduledCount += 1;
      },
      scheduleSyncOnHydrationChange: false,
      state,
    });

    expect(state.rootLaneHydrated).toBe(true);
    expect(scheduledCount).toBe(0);
  } finally {
    close();
  }
});

test("reset queues replacement hydration behind the stale generation", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-reset-hydration-generation",
  );
  try {
    type LaneResponse = Awaited<ReturnType<ListParentLanes>>;
    const resolvers: Array<(value: LaneResponse) => void> = [];
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const listContainerParentLanes: ListParentLanes = () =>
      new Promise<LaneResponse>((resolve) => {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        resolvers.push((value) => {
          activeRequests -= 1;
          resolve(value);
        });
      });
    const state = createRequestState(execSql, listContainerParentLanes);
    let staleCompletionCount = 0;
    let currentCompletionCount = 0;
    let scheduledCount = 0;
    const request = (onFullyHydrated: () => void) =>
      requestContainerContentsRemoteHydration({
        host: emptyHydrationHost,
        onFullyHydrated,
        parentIds: [null],
        scheduleSync: () => {
          scheduledCount += 1;
        },
        state,
      });

    const staleHydration = request(() => {
      staleCompletionCount += 1;
    });
    await waitFor(() => resolvers.length === 1);

    state.lifecycleGeneration += 1;
    state.containersById = new Map();
    state.containerParentIdsNeedingHydration = new Set();
    state.rootLaneHydrated = false;
    const replacementHydration = request(() => {
      currentCompletionCount += 1;
    });

    expect(resolvers).toHaveLength(1);
    resolvers[0]?.({
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
    });
    await waitFor(() => resolvers.length === 2);

    expect(state.remoteHydrationGeneration).toBe(1);
    expect(state.remoteHydrationPromise).not.toBeNull();
    expect(staleCompletionCount).toBe(0);
    resolvers[1]?.({
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
    });
    await Promise.all([staleHydration, replacementHydration]);

    expect(maxActiveRequests).toBe(1);
    expect(staleCompletionCount).toBe(0);
    expect(currentCompletionCount).toBe(1);
    expect(scheduledCount).toBe(1);
    expect(state.remoteHydrationPromise).toBeNull();
  } finally {
    close();
  }
});

test("a request queued before reset rehydrates the replacement generation", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-queued-hydration-reset-generation",
  );
  try {
    type LaneResponse = Awaited<ReturnType<ListParentLanes>>;
    const resolvers: Array<(value: LaneResponse) => void> = [];
    const listContainerParentLanes: ListParentLanes = () =>
      new Promise<LaneResponse>((resolve) => {
        resolvers.push(resolve);
      });
    const state = createRequestState(execSql, listContainerParentLanes);
    let replacementCompletionCount = 0;
    const request = (onFullyHydrated: () => void) =>
      requestContainerContentsRemoteHydration({
        host: emptyHydrationHost,
        onFullyHydrated,
        parentIds: [null],
        scheduleSync: () => {},
        state,
      });
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

    const activeHydration = request(() => {});
    await waitFor(() => resolvers.length === 1);
    const queuedHydration = request(() => {
      replacementCompletionCount += 1;
    });
    let resolveInitialization: () => void = () => {};
    const replacementInitialization = new Promise<void>((resolve) => {
      resolveInitialization = resolve;
    });
    state.lifecycleGeneration += 1;
    state.containersById = new Map();
    state.containerParentIdsNeedingHydration = new Set();
    state.initializePromise = replacementInitialization;
    state.rootLaneHydrated = false;

    resolvers[0]?.(laneResponse);
    await activeHydration;
    expect(resolvers).toHaveLength(1);
    state.initializePromise = null;
    resolveInitialization();
    await waitFor(() => resolvers.length === 2);
    expect(state.remoteHydrationGeneration).toBe(1);
    resolvers[1]?.(laneResponse);
    await Promise.all([activeHydration, queuedHydration]);

    expect(replacementCompletionCount).toBe(1);
    expect(state.rootLaneHydrated).toBe(true);
  } finally {
    close();
  }
});

test("stale hydration suppresses a late non-database failure", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-stale-hydration-failure",
  );
  try {
    let rejectRequest: (error: Error) => void = () => {
      throw new Error("request promise was not initialized");
    };
    let requestStarted = false;
    const state = createRequestState(
      execSql,
      () =>
        new Promise((_, reject) => {
          requestStarted = true;
          rejectRequest = reject;
        }),
    );
    const hydration = requestContainerContentsRemoteHydration({
      host: emptyHydrationHost,
      parentIds: [null],
      scheduleSync: () => {},
      state,
    });
    await waitFor(() => requestStarted);

    state.lifecycleGeneration += 1;
    rejectRequest(new Error("old connection failed"));

    await expect(hydration).resolves.toBeUndefined();
    expect(state.remoteHydrationPromise).toBeNull();
  } finally {
    close();
  }
});
