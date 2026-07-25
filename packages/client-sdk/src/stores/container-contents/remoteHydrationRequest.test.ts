import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { RemoteContainerHydrationHost } from "../../workflows/container-contents/remoteHydration";
import { requestContainerContentsRemoteHydration } from "./remoteHydrationRequest";

type RequestState = Parameters<
  typeof requestContainerContentsRemoteHydration
>[0]["state"];

test("first completed root hydration schedules recovery with no remote delta", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-root-lane-hydration-schedule",
  );
  try {
    let scheduledCount = 0;
    const state = {
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
    const host = {
      persistContainerState: async () => {
        throw new Error("empty root hydration cannot persist a container");
      },
      updateSnapshot: () => {},
    } as RemoteContainerHydrationHost;

    await requestContainerContentsRemoteHydration({
      host,
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
