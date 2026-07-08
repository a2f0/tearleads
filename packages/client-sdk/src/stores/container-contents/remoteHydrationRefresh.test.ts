import { expect, test } from "bun:test";
import { refreshRootRemoteHydration } from "./remoteHydrationRefresh";

type RefreshOptions = Parameters<
  Parameters<typeof refreshRootRemoteHydration>[0]["requestHydration"]
>[0];

function readyRefreshState(containerId: string | null = "root-container") {
  return {
    containerParentIdsNeedingHydration: new Set<string | null>(),
    containersById: new Map<string, unknown>(),
    initialized: true,
    remoteHydrationPromise: null,
    runtime: {
      auth: { isAuthenticated: true },
      infra: { dbStatus: "ready" },
      state: { containerId, online: true },
    },
  };
}

test("root refresh defaults to only the top-level lane without forcing no-op sync", async () => {
  const requests: RefreshOptions[] = [];

  await expect(
    refreshRootRemoteHydration({
      requestHydration: async (options) => {
        requests.push(options);
      },
      state: readyRefreshState("root-container"),
    }),
  ).resolves.toBe(true);

  expect(requests).toEqual([
    {
      followDiscoveredParentLanes: false,
      parentIds: [null],
      resetRootLaneWatermark: true,
    },
  ]);
});

test("root refresh can include the active root child lane for provisioned bootstrap", async () => {
  const requests: RefreshOptions[] = [];

  await expect(
    refreshRootRemoteHydration({
      includeActiveRootChildLane: true,
      requestHydration: async (options) => {
        requests.push(options);
      },
      state: readyRefreshState("root-container"),
    }),
  ).resolves.toBe(true);

  expect(requests).toEqual([
    {
      followDiscoveredParentLanes: false,
      parentIds: [null, "root-container"],
      resetRootLaneWatermark: true,
    },
  ]);
});

test("root refresh falls back to only the top-level lane before a root is known", async () => {
  const requests: RefreshOptions[] = [];

  await refreshRootRemoteHydration({
    includeActiveRootChildLane: true,
    requestHydration: async (options) => {
      requests.push(options);
    },
    state: readyRefreshState(null),
  });

  expect(requests[0]?.parentIds).toEqual([null]);
});
