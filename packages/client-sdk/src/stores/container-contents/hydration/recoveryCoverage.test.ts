import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ListContainerParentLanesResponse } from "@tearleads/validators/response";
import { withPrincipalPolicies } from "../../../../test/helpers/workflows/principalPolicyServiceFixture";
import { createDomainScope } from "../../../data/shared/domainScope";
import {
  ContainerSyncWatermarkRepository,
  createContainerParentSyncLane,
} from "../../../workflows/container-contents/containerPersistence";
import type { RemoteContainerHydrationHost } from "../../../workflows/container-contents/remoteHydration";
import {
  requestContainerContentsRemoteHydration,
  resumeContainerContentsRecoveryHydration,
} from "./remoteHydrationRequest";

type RequestState = Parameters<
  typeof requestContainerContentsRemoteHydration
>[0]["state"];

const emptyRootLane: ListContainerParentLanesResponse = {
  results: [
    {
      laneId: "lane-0",
      page: { hasMore: false, items: [], nextWatermark: null, tombstones: [] },
    },
  ],
};

function createRequestState(
  execSql: RequestState["runtime"]["infra"]["execSql"],
  listContainerParentLanes: RequestState["runtime"]["apiClient"]["listContainerParentLanes"],
): RequestState {
  return {
    containerListingFailures: 0,
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
    runtime: withPrincipalPolicies({
      apiClient: {
        listContainerParentLanes,
      },
      auth: { isAuthenticated: true },
      infra: { dbStatus: "ready", execSql },
      state: { domainScope: createDomainScope(), online: true },
      util: { log: () => {} },
    }),
    snapshot: { ready: true },
    structuralGeneration: 0,
  } as unknown as RequestState;
}

const emptyHydrationHost = {
  persistContainerState: async () => {
    throw new Error("an empty root lane persists nothing");
  },
  updateSnapshot: () => {},
} as RemoteContainerHydrationHost;

// Requests queued behind a crawl that a generation reset interrupts all retry
// through recovery, and one of them takes over the others' queued recovery.
// None may resolve before the recovery crawl that covers it settles; an
// explicit refresh would otherwise report success before its listing failed.
test("requests queued across a reset settle with the recovery crawl", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-hydration-recovery-coverage",
  );
  try {
    const listings: Array<
      PromiseWithResolvers<ListContainerParentLanesResponse | null>
    > = [];
    const listingStarted = Array.from({ length: 3 }, () =>
      Promise.withResolvers<void>(),
    );
    const state = createRequestState(execSql, () => {
      const listing =
        Promise.withResolvers<ListContainerParentLanesResponse | null>();
      listingStarted[listings.length]?.resolve();
      listings.push(listing);
      return listing.promise;
    });
    const request = () =>
      requestContainerContentsRemoteHydration({
        host: emptyHydrationHost,
        parentIds: [null],
        // Production resumes ingestion first, so a second resume can queue
        // its recovery before the first one takes the queue over.
        resumeRecoveryWork: async () => {
          await Promise.resolve();
          await resumeContainerContentsRecoveryHydration(state);
        },
        scheduleSync: () => {},
        state,
      });
    const settled: string[] = [];

    const running = request();
    await listingStarted[0]?.promise;
    const first = request().then(() => settled.push("first"));
    const second = request().then(() => settled.push("second"));
    state.structuralGeneration += 1;
    listings[0]?.resolve(emptyRootLane);
    await listingStarted[1]?.promise;
    listings[1]?.resolve(emptyRootLane);
    await listingStarted[2]?.promise;

    expect(settled).toEqual([]);
    listings[2]?.resolve(null);
    await Promise.all([running, first, second]);
    expect(settled.sort()).toEqual(["first", "second"]);
    expect(state.containerListingFailures).toBe(1);
  } finally {
    close();
  }
});

test.each([false, true])(
  "a manual reset survives supersession (offline during handoff: %s)",
  async (offline) => {
    const { close, execSql } = await createTestExecSql(
      "manual-refresh-handoff",
    );
    const holds = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    const started = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    const initial = { id: "initial", updatedAt: "2026-01-01T00:00:00.000Z" };
    const reset = { ...initial, id: "reset" };
    const lane = createContainerParentSyncLane(null);
    const cursors = new ContainerSyncWatermarkRepository(execSql);
    let requests = 0;
    const state = createRequestState(execSql, async ({ lanes }) => {
      const n = requests++;
      started[n]?.resolve();
      await holds[n]?.promise;
      return {
        results: lanes.map(({ laneId, watermark }) => ({
          laneId,
          page: {
            items: [],
            tombstones: [],
            hasMore: false,
            nextWatermark: watermark ?? reset,
          },
        })),
      };
    });
    const input = {
      state,
      host: emptyHydrationHost,
      parentIds: [null],
      followDiscoveredParentLanes: true,
      scheduleSync: () => {},
      resumeRecoveryWork: async () => {
        await resumeContainerContentsRecoveryHydration(state);
      },
    };
    try {
      await cursors.saveWatermark(lane, initial);
      const active = requestContainerContentsRemoteHydration(input);
      await started[0]?.promise;
      let current = true;
      const reconnect = requestContainerContentsRemoteHydration({
        ...input,
        reconnect: { isCurrent: () => current, record: () => {} },
      });
      const manual = requestContainerContentsRemoteHydration({
        ...input,
        resetAllLaneWatermarks: true,
      });
      holds[0]?.resolve();
      await started[1]?.promise;
      current = false;
      let connected = !offline;
      state.runtime = {
        ...state.runtime,
        liveHydrationStatus: () => (connected ? "ready" : "unavailable"),
        state: { ...state.runtime.state, online: connected },
      };
      if (offline) {
        holds[1]?.resolve();
        await Promise.all([active, reconnect, manual]);
        connected = true;
        state.runtime = {
          ...state.runtime,
          state: { ...state.runtime.state, online: true },
        };
        await resumeContainerContentsRecoveryHydration(state);
      }
      const replacement = requestContainerContentsRemoteHydration({
        ...input,
        reconnect: { isCurrent: () => true, record: () => {} },
      });
      holds[1]?.resolve();
      await Promise.all([active, reconnect, manual, replacement]);
      expect(await cursors.loadWatermark(lane)).toEqual(reset);
    } finally {
      for (const hold of holds) hold.resolve();
      await close();
    }
  },
);
