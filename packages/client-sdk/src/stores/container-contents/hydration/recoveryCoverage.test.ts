import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ListContainerParentLanesResponse } from "@tearleads/validators/response";
import { createDomainScope } from "../../../data/shared/domainScope";
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
    const state = {
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
      runtime: {
        apiClient: {
          listContainerParentLanes: () => {
            const listing =
              Promise.withResolvers<ListContainerParentLanesResponse | null>();
            listingStarted[listings.length]?.resolve();
            listings.push(listing);
            return listing.promise;
          },
        },
        auth: { isAuthenticated: true },
        infra: { dbStatus: "ready", execSql },
        state: { domainScope: createDomainScope(), online: true },
        util: { log: () => {} },
      },
      snapshot: { ready: true },
      structuralGeneration: 0,
    } as unknown as RequestState;
    const request = () =>
      requestContainerContentsRemoteHydration({
        host: {
          persistContainerState: async () => {
            throw new Error("an empty root lane persists nothing");
          },
          updateSnapshot: () => {},
        } as RemoteContainerHydrationHost,
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
