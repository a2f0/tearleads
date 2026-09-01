import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { RemoteContainerHydrationHost } from "../../workflows/container-contents/remoteHydration";
import {
  requestContainerContentsRemoteHydration,
  resumeContainerContentsRecoveryHydration,
} from "./remoteHydrationRequest";

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
    localContainerRefreshStructuralGeneration: null,
    localContainersNeedRefresh: false,
    persistence: {
      loadContainerHydrationTombstones: async () => [],
    },
    remoteHydrationPromise: null,
    remoteHydrationGeneration: null,
    remoteHydrationStructuralGeneration: null,
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
    structuralGeneration: 0,
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

function createResumeRecoveryWork(state: RequestState): () => Promise<void> {
  return async () => {
    await resumeContainerContentsRecoveryHydration(state);
  };
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
      resumeRecoveryWork: createResumeRecoveryWork(state),
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
      resumeRecoveryWork: createResumeRecoveryWork(state),
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

test("reset preserves disjoint lanes from active and queued hydrations", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-reset-hydration-generation",
  );
  try {
    type LaneResponse = Awaited<ReturnType<ListParentLanes>>;
    type LaneRequest = Parameters<ListParentLanes>[0];
    const requests: LaneRequest[] = [];
    const resolvers: Array<(value: LaneResponse) => void> = [];
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const listContainerParentLanes: ListParentLanes = (request) =>
      new Promise<LaneResponse>((resolve) => {
        requests.push(request);
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        resolvers.push((value) => {
          activeRequests -= 1;
          resolve(value);
        });
      });
    const state = createRequestState(execSql, listContainerParentLanes);
    const parentA = "550e8400-e29b-41d4-a716-446655440000";
    const parentB = "550e8400-e29b-42d4-a716-446655440000";
    const createLoadedParents = () =>
      new Map(
        [parentA, parentB].map((id) => [
          id,
          { container: { id, parentId: null } },
        ]),
      ) as RequestState["containersById"];
    state.containersById = createLoadedParents();
    let staleCompletionCount = 0;
    let currentCompletionCount = 0;
    let scheduledCount = 0;
    const request = (parentId: string, onFullyHydrated: () => void) =>
      requestContainerContentsRemoteHydration({
        host: emptyHydrationHost,
        onFullyHydrated,
        parentIds: [parentId],
        resetAllLaneWatermarks: true,
        resumeRecoveryWork: createResumeRecoveryWork(state),
        scheduleSync: () => {
          scheduledCount += 1;
        },
        state,
      });
    const resolveRequest = (index: number) => {
      const request = requests[index];
      if (!request) {
        throw new Error(`request ${index} was not initialized`);
      }
      resolvers[index]?.({
        results: request.lanes.map(({ laneId }) => ({
          laneId,
          page: {
            hasMore: false,
            items: [],
            nextWatermark: null,
            tombstones: [],
          },
        })),
      });
    };

    const staleHydration = request(parentA, () => {
      staleCompletionCount += 1;
    });
    await waitFor(() => resolvers.length === 1);

    state.lifecycleGeneration += 1;
    state.containersById = createLoadedParents();
    state.containerParentIdsNeedingHydration = new Set();
    state.rootLaneHydrated = false;
    const replacementHydration = request(parentB, () => {
      currentCompletionCount += 1;
    });

    expect(resolvers).toHaveLength(1);
    resolveRequest(0);
    await waitFor(() => resolvers.length === 2);

    expect(state.remoteHydrationGeneration).toBe(1);
    expect(state.remoteHydrationPromise).not.toBeNull();
    expect(staleCompletionCount).toBe(0);
    expect(requests[1]?.lanes.map(({ parentId }) => parentId).sort()).toEqual(
      [null, parentA, parentB].sort(),
    );
    resolveRequest(1);
    await waitFor(() => resolvers.length === 3);
    resolveRequest(2);
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
    let recreatedCompletionFactoryCount = 0;
    let replacementCompletionCount = 0;
    let staleQueuedCompletionCount = 0;
    const request = (
      onFullyHydrated: () => void,
      recreateOnFullyHydratedAfterReset?: () => () => void,
    ) =>
      requestContainerContentsRemoteHydration({
        host: emptyHydrationHost,
        onFullyHydrated,
        parentIds: [null],
        recreateOnFullyHydratedAfterReset,
        resumeRecoveryWork: createResumeRecoveryWork(state),
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
    const queuedHydration = request(
      () => {
        staleQueuedCompletionCount += 1;
      },
      () => {
        recreatedCompletionFactoryCount += 1;
        return () => {
          replacementCompletionCount += 1;
        };
      },
    );
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
    await Bun.sleep(1);
    expect(resolvers).toHaveLength(1);
    state.initializePromise = null;
    resolveInitialization();
    await waitFor(() => resolvers.length === 2);
    expect(state.remoteHydrationGeneration).toBe(1);
    resolvers[1]?.(laneResponse);
    await waitFor(() => resolvers.length === 3);
    resolvers[2]?.(laneResponse);
    await Promise.all([activeHydration, queuedHydration]);

    expect(staleQueuedCompletionCount).toBe(0);
    expect(recreatedCompletionFactoryCount).toBe(1);
    expect(replacementCompletionCount).toBe(1);
    expect(state.rootLaneHydrated).toBe(true);
  } finally {
    close();
  }
});

test("completion recreation waits for readiness across consecutive resets", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-active-hydration-reset-retry",
  );
  try {
    type LaneResponse = Awaited<ReturnType<ListParentLanes>>;
    const resolvers: Array<(value: LaneResponse) => void> = [];
    const state = createRequestState(
      execSql,
      () =>
        new Promise<LaneResponse>((resolve) => {
          resolvers.push(resolve);
        }),
    );
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
    let resolveInitialization: () => void = () => {};
    let staleCompletionCount = 0;
    let recreatedCompletionCount = 0;
    let recreatedCompletionFactoryCount = 0;
    const recreatedCompletionContexts: Array<{
      dbStatus: string;
      lifecycleGeneration: number;
    }> = [];
    const hydration = requestContainerContentsRemoteHydration({
      host: emptyHydrationHost,
      onFullyHydrated: () => {
        staleCompletionCount += 1;
      },
      parentIds: [null],
      resumeRecoveryWork: createResumeRecoveryWork(state),
      recreateOnFullyHydratedAfterReset: () => {
        recreatedCompletionFactoryCount += 1;
        recreatedCompletionContexts.push({
          dbStatus: state.runtime.infra.dbStatus,
          lifecycleGeneration: state.lifecycleGeneration,
        });
        return () => {
          recreatedCompletionCount += 1;
        };
      },
      scheduleSync: () => {},
      state,
    });
    await waitFor(() => resolvers.length === 1);

    state.lifecycleGeneration += 1;
    state.containersById = new Map();
    state.containerParentIdsNeedingHydration = new Set();
    state.rootLaneHydrated = false;
    (state.runtime.infra as { dbStatus: string }).dbStatus = "idle";
    resolvers[0]?.(laneResponse);
    await hydration;
    expect(resolvers).toHaveLength(1);
    expect(staleCompletionCount).toBe(0);
    expect(recreatedCompletionCount).toBe(0);
    expect(recreatedCompletionFactoryCount).toBe(0);

    state.initializePromise = new Promise<void>((resolve) => {
      resolveInitialization = resolve;
    });
    (state.runtime.infra as { dbStatus: string }).dbStatus = "ready";
    const recoveryHydration = resumeContainerContentsRecoveryHydration(state);
    expect(recoveryHydration).not.toBeNull();
    await Bun.sleep(1);
    expect(resolvers).toHaveLength(1);

    state.initializePromise = null;
    resolveInitialization();
    await waitFor(() => resolvers.length === 2);
    expect(recreatedCompletionContexts).toEqual([
      { dbStatus: "ready", lifecycleGeneration: 1 },
    ]);

    state.lifecycleGeneration += 1;
    state.containersById = new Map();
    state.containerParentIdsNeedingHydration = new Set();
    state.rootLaneHydrated = false;
    (state.runtime.infra as { dbStatus: string }).dbStatus = "idle";
    resolvers[1]?.(laneResponse);
    await recoveryHydration;

    expect(recreatedCompletionCount).toBe(0);
    expect(recreatedCompletionFactoryCount).toBe(1);
    (state.runtime.infra as { dbStatus: string }).dbStatus = "ready";
    const finalRecoveryHydration =
      resumeContainerContentsRecoveryHydration(state);
    expect(finalRecoveryHydration).not.toBeNull();
    await waitFor(() => resolvers.length === 3);
    expect(recreatedCompletionContexts).toEqual([
      { dbStatus: "ready", lifecycleGeneration: 1 },
      { dbStatus: "ready", lifecycleGeneration: 2 },
    ]);
    resolvers[2]?.(laneResponse);
    await finalRecoveryHydration;

    expect(staleCompletionCount).toBe(0);
    expect(recreatedCompletionCount).toBe(1);
    expect(state.rootLaneHydrated).toBe(true);
    expect(state.remoteHydrationPromise).toBeNull();
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
      resumeRecoveryWork: createResumeRecoveryWork(state),
      scheduleSync: () => {},
      state,
    });
    await waitFor(() => requestStarted);

    state.lifecycleGeneration += 1;
    (state.runtime.infra as { dbStatus: string }).dbStatus = "idle";
    rejectRequest(new Error("old connection failed"));

    await expect(hydration).resolves.toBeUndefined();
    expect(state.remoteHydrationPromise).toBeNull();
  } finally {
    close();
  }
});
