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

test("ready reset retries hydration behind queued ingestion", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-ready-reset-recovery-order",
  );
  try {
    const order: string[] = [];
    const resolvers: Array<(value: LaneResponse) => void> = [];
    const state = {
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
          listContainerParentLanes: () =>
            new Promise<LaneResponse>((resolve) => {
              order.push(`hydration-${resolvers.length + 1}`);
              resolvers.push(resolve);
            }),
        },
        auth: { isAuthenticated: true },
        infra: { dbStatus: "ready", execSql },
        state: { online: true },
        util: { log: () => {} },
      },
      snapshot: { ready: true },
    } as unknown as RequestState;
    let resolveIngestion: () => void = () => {
      throw new Error("ingestion promise was not initialized");
    };
    const ingestion = new Promise<void>((resolve) => {
      resolveIngestion = () => {
        order.push("ingestion");
        resolve();
      };
    });
    const resumeRecoveryWork = () =>
      resumeRemoteContainerRecoveryWork({
        onHydrationError: (error) => {
          throw error;
        },
        onIngestionError: (error) => {
          throw error;
        },
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
