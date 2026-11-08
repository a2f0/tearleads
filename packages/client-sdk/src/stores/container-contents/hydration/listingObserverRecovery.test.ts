import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ListContainerParentLanesResponse } from "@tearleads/validators/response";
import { createDomainScope } from "../../../data/shared/domainScope";
import type { RemoteContainerHydrationHost } from "../../../workflows/container-contents/remoteHydration";
import {
  requestContainerContentsRemoteHydration,
  resumeContainerContentsRecoveryHydration,
} from "./remoteHydrationRequest";

type RequestInput = Parameters<
  typeof requestContainerContentsRemoteHydration
>[0];

const emptyRootLane: ListContainerParentLanesResponse = {
  results: [
    {
      laneId: "lane-0",
      page: { hasMore: false, items: [], nextWatermark: null, tombstones: [] },
    },
  ],
};

// A request whose queued lanes another request's crawl took over joins that
// crawl. When a generation reset restarts the crawl, the restart must still
// report a listing failure to the joined request, not only to the request
// that started the crawl.
test("a joined refresh learns of a listing failure after its crawl restarts", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-listing-observer-recovery",
  );
  try {
    const listings: Array<
      PromiseWithResolvers<ListContainerParentLanesResponse | null>
    > = [];
    const listingStarted: Array<PromiseWithResolvers<void>> = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
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
    } as unknown as RequestInput["state"];
    const unavailable = { joined: 0, starter: 0 };
    const request = (onListingUnavailable?: () => void) =>
      requestContainerContentsRemoteHydration({
        host: {
          persistContainerState: async () => {
            throw new Error("an empty root lane persists nothing");
          },
          updateSnapshot: () => {},
        } as RemoteContainerHydrationHost,
        onListingUnavailable,
        parentIds: [null],
        resumeRecoveryWork: async () => {
          await resumeContainerContentsRecoveryHydration(state);
        },
        scheduleSync: () => {},
        state,
      });

    const running = request();
    await listingStarted[0]?.promise;
    // Both queue behind the running crawl; the first starts the follow-up
    // crawl with both requests' lanes, and the second joins it.
    const starter = request(() => {
      unavailable.starter += 1;
    });
    const joined = request(() => {
      unavailable.joined += 1;
    });
    listings[0]?.resolve(emptyRootLane);
    await listingStarted[1]?.promise;

    state.structuralGeneration += 1;
    listings[1]?.resolve(emptyRootLane);
    await listingStarted[2]?.promise;
    listings[2]?.resolve(null);

    await Promise.all([running, starter, joined]);
    expect(unavailable).toEqual({ joined: 1, starter: 1 });
  } finally {
    close();
  }
});
