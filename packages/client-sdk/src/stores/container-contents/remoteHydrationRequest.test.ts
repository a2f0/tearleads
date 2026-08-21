import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { RemoteContainerHydrationHost } from "../../workflows/container-contents/remoteHydration";
import { requestContainerContentsRemoteHydration } from "./remoteHydrationRequest";

type RequestState = Parameters<
  typeof requestContainerContentsRemoteHydration
>[0]["state"];

function createRequestState(execSql: ExecSql): RequestState {
  return {
    containerParentIdsNeedingHydration: new Set<string | null>(),
    containersById: new Map(),
    initialized: true,
    localContainerRefreshPromise: null,
    localContainersNeedRefresh: false,
    persistence: {},
    remoteHydrationPromise: null,
    rootLaneHydrated: false,
    runtime: {
      apiClient: {
        listContainerParentLanes: async () => ({
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
        }),
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
