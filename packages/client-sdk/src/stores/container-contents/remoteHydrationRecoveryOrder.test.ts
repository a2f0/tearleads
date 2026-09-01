import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { RemoteContainerHydrationHost } from "../../workflows/container-contents/remoteHydration";
import { resumeRemoteContainerRecoveryWork } from "./remoteContainerIngestion";
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
type LaneRequest = Parameters<ListParentLanes>[0];
type RequestContainerState =
  RequestState["containersById"] extends Map<string, infer Value>
    ? Value
    : never;

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

function createRequestState(input: {
  execSql: RequestState["runtime"]["infra"]["execSql"];
  isAuthenticated?: boolean;
  listContainerParentLanes: ListParentLanes;
  online?: boolean;
}): RequestState {
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
        listContainerParentLanes: input.listContainerParentLanes,
      },
      auth: { isAuthenticated: input.isAuthenticated ?? true },
      infra: { dbStatus: "ready", execSql: input.execSql },
      state: { online: input.online ?? true },
      util: { log: () => {} },
    },
    snapshot: { ready: true },
    structuralGeneration: 0,
  } as unknown as RequestState;
}

function createRecoveryWork(input: {
  resumeHydration: () => Promise<void>;
  resumeIngestion?: (() => Promise<void>) | undefined;
}): () => Promise<void> {
  return () =>
    resumeRemoteContainerRecoveryWork({
      onHydrationError: (error) => {
        throw error;
      },
      onIngestionError: (error) => {
        throw error;
      },
      resumeHydration: input.resumeHydration,
      resumeIngestion: input.resumeIngestion ?? (async () => {}),
    });
}

function createLaneResponse(request: LaneRequest): LaneResponse {
  return {
    results: request.lanes.map(({ laneId }) => ({
      laneId,
      page: {
        hasMore: false,
        items: [],
        nextWatermark: null,
        tombstones: [],
      },
    })),
  };
}

test("ready reset retries hydration behind queued ingestion", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-ready-reset-recovery-order",
  );
  try {
    const order: string[] = [];
    const resolvers: Array<(value: LaneResponse) => void> = [];
    const state = createRequestState({
      execSql,
      listContainerParentLanes: () =>
        new Promise<LaneResponse>((resolve) => {
          order.push(`hydration-${resolvers.length + 1}`);
          resolvers.push(resolve);
        }),
    });
    let resolveIngestion: () => void = () => {
      throw new Error("ingestion promise was not initialized");
    };
    const ingestion = new Promise<void>((resolve) => {
      resolveIngestion = () => {
        order.push("ingestion");
        resolve();
      };
    });
    const resumeRecoveryWork = createRecoveryWork({
      resumeHydration: async () => {
        order.push("resume-hydration");
        await resumeContainerContentsRecoveryHydration(state);
      },
      resumeIngestion: async () => {
        order.push("resume-ingestion");
        await ingestion;
      },
    });
    const hydration = requestContainerContentsRemoteHydration({
      host: emptyHydrationHost,
      parentIds: [null],
      resumeRecoveryWork,
      scheduleSync: () => {},
      state,
    });
    await waitFor(() => resolvers.length === 1);

    state.lifecycleGeneration += 1;
    state.containersById = new Map();
    state.containerParentIdsNeedingHydration = new Set();
    state.rootLaneHydrated = false;
    resolvers[0]?.(laneResponse);
    await waitFor(() => order.includes("resume-ingestion"));

    expect(state.runtime.infra.dbStatus).toBe("ready");
    expect(resolvers).toHaveLength(1);
    expect(order).toEqual(["hydration-1", "resume-ingestion"]);

    resolveIngestion();
    await waitFor(() => resolvers.length === 2);
    expect(order).toEqual([
      "hydration-1",
      "resume-ingestion",
      "ingestion",
      "resume-hydration",
      "hydration-2",
    ]);
    resolvers[1]?.(laneResponse);
    await hydration;

    expect(state.rootLaneHydrated).toBe(true);
    expect(state.remoteHydrationPromise).toBeNull();
  } finally {
    close();
  }
});

test("post-initialization hydration drains released ingestion first", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-initialization-ingestion-hydration-order",
  );
  try {
    const order: string[] = [];
    let resolveHydration: (value: LaneResponse) => void = () => {
      throw new Error("hydration promise was not initialized");
    };
    let resolveIngestion: () => void = () => {
      throw new Error("ingestion promise was not initialized");
    };
    let resolveInitialization: () => void = () => {
      throw new Error("initialization promise was not initialized");
    };
    const state = createRequestState({
      execSql,
      listContainerParentLanes: () =>
        new Promise<LaneResponse>((resolve) => {
          order.push("hydration");
          resolveHydration = resolve;
        }),
    });
    const ingestion = new Promise<void>((resolve) => {
      resolveIngestion = () => {
        order.push("ingestion");
        resolve();
      };
    });
    state.initializePromise = new Promise<void>((resolve) => {
      resolveInitialization = resolve;
    });
    const resumeRecoveryWork = createRecoveryWork({
      resumeHydration: async () => {
        order.push("resume-hydration");
        await resumeContainerContentsRecoveryHydration(state);
      },
      resumeIngestion: async () => {
        order.push("resume-ingestion");
        await ingestion;
      },
    });
    const hydration = requestContainerContentsRemoteHydration({
      host: emptyHydrationHost,
      parentIds: [null],
      resumeRecoveryWork,
      scheduleSync: () => {},
      state,
    });

    expect(order).toEqual([]);
    state.initializePromise = null;
    resolveInitialization();
    await waitFor(() => order.includes("resume-ingestion"));
    expect(order).toEqual(["resume-ingestion"]);

    resolveIngestion();
    await waitFor(() => order.includes("hydration"));
    expect(order).toEqual([
      "resume-ingestion",
      "ingestion",
      "resume-hydration",
      "hydration",
    ]);
    resolveHydration(laneResponse);
    await hydration;
  } finally {
    close();
  }
});

test("offline recovery hydration remains queued until reconnect", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-offline-recovery-hydration",
  );
  try {
    let hydrationRequests = 0;
    const state = createRequestState({
      execSql,
      listContainerParentLanes: async (request) => {
        hydrationRequests += 1;
        return createLaneResponse(request);
      },
      online: false,
    });
    let recreatedCompletionCount = 0;
    let recreatedCompletionFactoryCount = 0;
    let staleCompletionCount = 0;
    const resumeRecoveryWork = createRecoveryWork({
      resumeHydration: async () => {
        await resumeContainerContentsRecoveryHydration(state);
      },
    });

    await requestContainerContentsRemoteHydration({
      host: emptyHydrationHost,
      onFullyHydrated: () => {
        staleCompletionCount += 1;
      },
      parentIds: [null],
      recreateOnFullyHydratedAfterReset: () => {
        recreatedCompletionFactoryCount += 1;
        return () => {
          recreatedCompletionCount += 1;
        };
      },
      resumeRecoveryWork,
      scheduleSync: () => {},
      state,
    });
    state.lifecycleGeneration += 1;
    state.containerParentIdsNeedingHydration = new Set();
    await resumeRecoveryWork();

    expect(hydrationRequests).toBe(0);
    expect(staleCompletionCount).toBe(0);
    expect(recreatedCompletionFactoryCount).toBe(0);
    expect(state.rootLaneHydrated).toBe(false);

    (state.runtime.state as { online: boolean }).online = true;
    await resumeRecoveryWork();

    expect(hydrationRequests).toBe(1);
    expect(staleCompletionCount).toBe(0);
    expect(recreatedCompletionFactoryCount).toBe(1);
    expect(recreatedCompletionCount).toBe(1);
    expect(state.rootLaneHydrated).toBe(true);
  } finally {
    close();
  }
});

test("network loss during hydration retains the lane for reconnect", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-mid-hydration-network-loss",
  );
  try {
    let firstResponse: LaneResponse = laneResponse;
    let resolveFirstRequest: (value: LaneResponse) => void = () => {
      throw new Error("hydration promise was not initialized");
    };
    const requestedParentIds: Array<Array<string | null>> = [];
    const state = createRequestState({
      execSql,
      listContainerParentLanes: (request) => {
        requestedParentIds.push(request.lanes.map(({ parentId }) => parentId));
        if (requestedParentIds.length > 1) {
          return Promise.resolve(createLaneResponse(request));
        }
        firstResponse = createLaneResponse(request);
        return new Promise<LaneResponse>((resolve) => {
          resolveFirstRequest = resolve;
        });
      },
    });
    let recreatedCompletionCount = 0;
    let recreatedCompletionFactoryCount = 0;
    let staleCompletionCount = 0;
    const resumeRecoveryWork = createRecoveryWork({
      resumeHydration: async () => {
        await resumeContainerContentsRecoveryHydration(state);
      },
    });
    const hydration = requestContainerContentsRemoteHydration({
      host: emptyHydrationHost,
      onFullyHydrated: () => {
        staleCompletionCount += 1;
      },
      parentIds: [null],
      recreateOnFullyHydratedAfterReset: () => {
        recreatedCompletionFactoryCount += 1;
        return () => {
          recreatedCompletionCount += 1;
        };
      },
      resumeRecoveryWork,
      scheduleSync: () => {},
      state,
    });
    await waitFor(() => requestedParentIds.length === 1);

    state.containersById.set("new-root", {
      container: { id: "new-root", parentId: null },
    } as RequestContainerState);
    (state.runtime.state as { online: boolean }).online = false;
    resolveFirstRequest(firstResponse);
    await hydration;

    expect(staleCompletionCount).toBe(0);
    expect(recreatedCompletionFactoryCount).toBe(0);
    expect(state.rootLaneHydrated).toBe(false);

    (state.runtime.state as { online: boolean }).online = true;
    await resumeRecoveryWork();

    expect(requestedParentIds).toEqual([[null], [null, "new-root"]]);
    expect(staleCompletionCount).toBe(0);
    expect(recreatedCompletionFactoryCount).toBe(1);
    expect(recreatedCompletionCount).toBe(1);
    expect(state.rootLaneHydrated).toBe(true);
  } finally {
    close();
  }
});

test("database failure before reset retains lanes and recreated completion", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-error-before-reset-hydration",
  );
  try {
    const requestedParentIds: Array<Array<string | null>> = [];
    let hydrationAttempt = 0;
    const state = createRequestState({
      execSql,
      listContainerParentLanes: async (request) => {
        hydrationAttempt += 1;
        requestedParentIds.push(request.lanes.map(({ parentId }) => parentId));
        if (hydrationAttempt === 1) {
          throw new Error("DB has been closed.");
        }
        return createLaneResponse(request);
      },
    });
    let recreatedCompletionCount = 0;
    let recreatedCompletionFactoryCount = 0;
    let staleCompletionCount = 0;
    const resumeRecoveryWork = createRecoveryWork({
      resumeHydration: async () => {
        await resumeContainerContentsRecoveryHydration(state);
      },
    });

    await requestContainerContentsRemoteHydration({
      host: emptyHydrationHost,
      onFullyHydrated: () => {
        staleCompletionCount += 1;
      },
      parentIds: [null],
      recreateOnFullyHydratedAfterReset: () => {
        recreatedCompletionFactoryCount += 1;
        return () => {
          recreatedCompletionCount += 1;
        };
      },
      resumeRecoveryWork,
      scheduleSync: () => {},
      state,
    });

    expect(hydrationAttempt).toBe(1);
    expect(staleCompletionCount).toBe(0);
    expect(recreatedCompletionFactoryCount).toBe(0);

    state.lifecycleGeneration += 1;
    state.containersById = new Map();
    state.containerParentIdsNeedingHydration = new Set();
    state.rootLaneHydrated = false;
    (state.runtime.infra as { dbStatus: string }).dbStatus = "idle";
    (state.runtime.infra as { dbStatus: string }).dbStatus = "ready";
    await resumeRecoveryWork();

    expect(hydrationAttempt).toBe(2);
    expect(requestedParentIds).toEqual([[null], [null]]);
    expect(staleCompletionCount).toBe(0);
    expect(recreatedCompletionFactoryCount).toBe(1);
    expect(recreatedCompletionCount).toBe(1);
    expect(state.rootLaneHydrated).toBe(true);
  } finally {
    close();
  }
});
