import { expect, test } from "bun:test";
import { createReconciliationService } from "./service";
import {
  createGate,
  createManualReconciliationClock,
  createOwedLaneHost,
  OWED_LANE_HOST_CONTAINER_IDS,
} from "./service.testFixtures";
import type { ReconciliationHost } from "./serviceTypes";

const KNOWN = OWED_LANE_HOST_CONTAINER_IDS;

const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

/**
 * A started service whose catch-up waits on a crawl the test settles by
 * opening `crawl`, on a clock that never runs out by itself.
 */
function awaitingCrawl(input: {
  readonly known?: () => ReadonlyArray<string>;
  readonly owed?: () => ReadonlyArray<string>;
  readonly overrides?: Partial<ReconciliationHost>;
}) {
  const crawl = createGate();
  const fixture = createOwedLaneHost({
    known: input.known,
    overrides: {
      clock: createManualReconciliationClock(),
      whenTreeCrawlSettles: async () => {
        await crawl.wait;
        return true;
      },
      ...input.overrides,
    },
    owed: input.owed ?? (() => []),
  });
  const service = createReconciliationService(fixture.host);
  service.start();
  return { ...fixture, crawl, service };
}

test("a hint during the wait lists its lane at once", async () => {
  const { crawl, listings, service } = awaitingCrawl({});
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();

  service.enqueueContainer("b", "active", true);
  await settle();
  await settle();
  expect(listings).toEqual([["b"]]);

  // The hint's listing answered it; the crawl vouches for the rest.
  crawl.open();
  await catchUp;
  expect(listings).toEqual([["b"]]);
  service.stop();
});

test("a hint queued before the catch-up's turn is listed by its sweep", async () => {
  const forced: boolean[] = [];
  const { host, listings, service } = awaitingCrawl({
    overrides: { whenTreeCrawlSettles: async () => true },
  });
  host.requestDocumentContentPull = (_containerId, _documents, force) => {
    forced.push(force);
  };

  // The hint lands with the acknowledgement: the crawl has settled, nothing
  // owes lane b, and the sweep takes the queue before the lane runs.
  const catchUp = service.reconcileAcknowledgedConnection();
  service.enqueueContainer("b", "idle", true);
  await catchUp;
  await settle();

  // The forced lane is listed in the sweep, with its force, not handed back
  // to wait out a retry backoff.
  expect(listings).toEqual([["b"]]);
  expect(forced).toEqual([true]);
  service.stop();
});

test("opening a folder during the wait lists it at once", async () => {
  const { crawl, listings, service } = awaitingCrawl({});
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();

  service.setActiveContainer("c");
  await settle();
  await settle();
  expect(listings).toEqual([["c"]]);

  crawl.open();
  await catchUp;
  expect(listings).toEqual([["c"]]);
  service.stop();
});

test("a reconnect's re-queue of the folder already open waits for the crawl", async () => {
  const { crawl, listings, service } = awaitingCrawl({});
  service.setActiveContainer("c");
  await settle();
  await settle();
  expect(listings).toEqual([["c"]]);

  // Coming back online queues the open folder again, then the connection
  // is acknowledged: nothing was opened, so the crawl decides.
  service.resetDiscovered();
  const catchUp = service.reconcileAcknowledgedConnection();
  service.enqueueContainer("c", "active");
  await settle();
  await settle();
  expect(listings).toEqual([["c"]]);

  crawl.open();
  await catchUp;
  expect(listings).toEqual([["c"]]);
  service.stop();
});

test("a root refresh during the wait leaves the catch-up's lanes to it", async () => {
  let rootListings = 0;
  const { crawl, listings, service } = awaitingCrawl({
    overrides: {
      listAutomaticRootCatchupContainerIds: () => [...KNOWN],
      refreshRootTree: async () => {
        rootListings += 1;
      },
    },
  });
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();

  // Explorer opens: the root lane is listed, and no document lane the
  // catch-up will list or vouch for.
  await service.reconcileRootContainersNow();
  expect(rootListings).toBe(1);
  expect(listings).toEqual([]);

  // The crawl was served no row, so a settled restart lists no lane at all.
  crawl.open();
  await catchUp;
  expect(listings).toEqual([]);
  service.stop();
});

test("a root refresh during the wait still lists a lane found since", async () => {
  let known: ReadonlyArray<string> = [...KNOWN];
  const { listings, service } = awaitingCrawl({
    known: () => known,
    overrides: {
      listAutomaticRootCatchupContainerIds: () => [...known],
    },
  });
  void service.reconcileAcknowledgedConnection();
  await settle();

  // A folder shared with this user since the acknowledgement: the crawl the
  // catch-up waits on was never asked about it.
  known = [...KNOWN, "shared"];
  await service.reconcileRootContainersNow();

  expect(listings).toEqual([["shared"]]);
  service.stop();
});

test("an acknowledgement during the wait shares it", async () => {
  const { crawl, listings, service } = awaitingCrawl({ owed: () => ["a"] });
  const first = service.reconcileAcknowledgedConnection();
  await settle();
  const second = service.reconcileAcknowledgedConnection();

  expect(second).toBe(first);
  crawl.open();
  await second;
  expect(listings).toEqual([["a"]]);
  service.stop();
});

test("lanes queued during the wait are listed once, in the catch-up's sweep", async () => {
  let known: ReadonlyArray<string> = [];
  let owed: ReadonlyArray<string> = [];
  const { crawl, listings, service } = awaitingCrawl({
    known: () => known,
    owed: () => owed,
  });
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();

  // The crawl finds the tree of a new device, which the projection queues
  // for an idle listing as it appears.
  known = [...KNOWN];
  owed = [...KNOWN];
  service.enqueueIdleBackfill();
  await settle();
  expect(listings).toEqual([]);

  crawl.open();
  await catchUp;
  await settle();
  expect(listings).toEqual([[...KNOWN]]);
  service.stop();
});

test("a container found while the owed record is read is not vouched for", async () => {
  const read = createGate();
  let known: ReadonlyArray<string> = [...KNOWN];
  const { host, listings, service } = awaitingCrawl({
    known: () => known,
    overrides: { whenTreeCrawlSettles: async () => true },
  });
  host.listOwedDocumentDiscoveryContainerIds = async () => {
    await read.wait;
    return [];
  };
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();

  // The owed record was asked about a, b and c. A folder that appears before
  // it answers was never tested, so nothing vouches for it.
  known = [...KNOWN, "found"];
  read.open();
  await catchUp;
  expect(listings).toEqual([]);

  service.enqueueContainer("found", "idle");
  await settle();
  await settle();
  expect(listings).toEqual([["found"]]);
  service.stop();
});

test("a service stopped during the wait drops the catch-up", async () => {
  const { crawl, listings, service } = awaitingCrawl({ owed: () => ["a"] });
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();

  service.stop();
  await catchUp;
  crawl.open();
  await settle();

  expect(listings).toEqual([]);
});
