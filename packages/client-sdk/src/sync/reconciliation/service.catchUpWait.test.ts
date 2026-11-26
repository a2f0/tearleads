import { expect, test } from "bun:test";
import { SWEEP_RETRY_BACKOFF_MS } from "./laneFailure";
import {
  awaitingCrawl,
  createGate,
  OWED_LANE_HOST_CONTAINER_IDS,
} from "./service.testFixtures";

const KNOWN = OWED_LANE_HOST_CONTAINER_IDS;

const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

test("a lane already owed at the acknowledgement is not held for the crawl", async () => {
  // Lane a was never listed: no crawl can vouch for it.
  const { crawl, listings, service } = awaitingCrawl({ owed: () => ["a"] });
  const catchUp = service.reconcileAcknowledgedConnection();
  for (const containerId of KNOWN)
    service.enqueueContainer(containerId, "idle");
  await settle();
  await settle();
  expect(listings).toEqual([["a"]]);

  // The rest waited for the crawl, which vouches for them.
  crawl.open();
  await catchUp;
  await settle();
  expect(listings[0]).toEqual(["a"]);
  expect(listings.flat().filter((id) => id !== "a")).toEqual([]);
  service.stop();
});

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

test("a root refresh that plans after the crawl settled still leaves the lanes", async () => {
  const rootTree = createGate();
  const { crawl, listings, service } = awaitingCrawl({
    overrides: {
      listAutomaticRootCatchupContainerIds: () => [...KNOWN],
      refreshRootTree: () => rootTree.wait,
    },
  });
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();
  // The root refresh takes its turn first; its own tree listing is slow.
  const rootRefresh = service.reconcileRootContainersNow();
  await settle();

  // The crawl settles, and the catch-up waits behind the root refresh.
  crawl.open();
  await settle();
  rootTree.open();
  await Promise.all([rootRefresh, catchUp]);

  // The root sweep read its plan after the crawl settled and before the
  // catch-up's turn: the lanes were still the catch-up's to vouch for.
  expect(listings).toEqual([]);
  service.stop();
});

test("a crawl whose outcome cannot be read vouches for nothing", async () => {
  const errors: unknown[] = [];
  const failure = new Error("port failed");
  const { listings, service } = awaitingCrawl({
    overrides: {
      logError: (_message, error) => {
        errors.push(error);
      },
      whenTreeCrawlSettles: () => Promise.reject(failure),
    },
  });
  // A lane queued while the catch-up waited must not be left stranded.
  const catchUp = service.reconcileAcknowledgedConnection();
  service.enqueueContainer("a", "idle");

  await catchUp;
  await settle();

  expect(listings).toEqual([[...KNOWN]]);
  expect(errors).toEqual([failure]);
  service.stop();
});

test("a catch-up that cannot take its turn stops deferring", async () => {
  let online = true;
  const { crawl, listings, service } = awaitingCrawl({
    overrides: {
      getRuntimeStatus: () => ({
        dbStatus: "ready",
        isAuthenticated: true,
        online,
      }),
    },
  });
  const catchUp = service.reconcileAcknowledgedConnection();
  service.enqueueContainer("a", "idle");
  await settle();
  expect(listings).toEqual([]);

  // The device goes offline before the crawl settles, so the sweep never
  // reads its plan. The catch-up is over all the same: once the device is
  // back, the lane lists what was deferred with whatever is queued next.
  online = false;
  crawl.open();
  await catchUp;
  online = true;
  service.enqueueContainer("b", "idle");
  await settle();
  await settle();

  expect(listings).toEqual([["a", "b"]]);
  service.stop();
});

test("a lane the catch-up's sweep failed waits out its retry backoff", async () => {
  let fail = true;
  const { host, listings, service } = awaitingCrawl({
    overrides: {
      logError: () => undefined,
      whenTreeCrawlSettles: async () => true,
    },
    owed: () => ["b"],
  });
  const discover = host.discoverContainerDocuments;
  host.discoverContainerDocuments = async (requests, onOutcome) => {
    if (!fail) return discover(requests, onOutcome);
    listings.push(requests.map((request) => request.containerId));
    throw new Error("listing failed");
  };

  await service.reconcileAcknowledgedConnection().catch(() => undefined);
  const failedAt = performance.now();
  fail = false;
  // The failed lane is queued again, and the lane is not woken at once: its
  // retry comes no sooner than the backoff, however slow the machine is.
  while (listings.length < 2) {
    if (performance.now() - failedAt > 20_000) break;
    await Bun.sleep(20);
  }
  expect(listings).toEqual([["b"], ["b"]]);
  expect(performance.now() - failedAt).toBeGreaterThanOrEqual(
    SWEEP_RETRY_BACKOFF_MS - 50,
  );
  service.stop();
}, 30_000);

test("a catch-up queued across a restart vouches for nothing in the new session", async () => {
  const rootTree = createGate();
  const { listings, service } = awaitingCrawl({
    overrides: {
      refreshRootTree: () => rootTree.wait,
      whenTreeCrawlSettles: async () => true,
    },
  });
  // The catch-up's crawl has settled; it waits its turn behind a refresh.
  const rootRefresh = service.reconcileRootContainersNow().catch(() => {});
  await settle();
  const catchUp = service.reconcileAcknowledgedConnection().catch(() => {});
  await settle();

  service.stop();
  service.start();
  rootTree.open();
  await Promise.all([rootRefresh, catchUp]);
  await settle();

  // The old session's crawl is not the new session's knowledge.
  service.enqueueContainer("a", "idle");
  await settle();
  await settle();
  expect(listings).toEqual([["a"]]);
  service.stop();
});

test("the initial probe is not left waiting by a catch-up that deferred the backfill", async () => {
  const probed: string[][] = [];
  const { crawl, listings, service } = awaitingCrawl({
    overrides: {
      listContainerDocumentIds: async (containerIds) => {
        probed.push([...containerIds]);
        return new Map(containerIds.map((id) => [id, []]));
      },
    },
  });
  const catchUp = service.reconcileAcknowledgedConnection();
  // Coming back online arms the probe and queues every lane, all deferred.
  service.enqueueIdleBackfill();
  await settle();
  await settle();
  // The probe runs once the queue is empty, and the queue holds what the
  // catch-up deferred.
  expect(probed).toEqual([]);

  // The catch-up's sweep settles every lane without a listing. Nothing is
  // queued after it, so it is the catch-up that resumes the probe.
  crawl.open();
  await catchUp;
  await settle();
  await settle();
  expect(listings).toEqual([]);
  expect(probed).toEqual([[...KNOWN]]);
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

test("lanes found after the acknowledgement are listed without waiting", async () => {
  let known: ReadonlyArray<string> = [];
  const { listings, service } = awaitingCrawl({ known: () => known });
  void service.reconcileAcknowledgedConnection();
  await settle();

  // A new device's folders become known while it boots, after its
  // connection was acknowledged. None was ever listed, so no crawl can vouch
  // for them, and what they hold must not wait for one.
  known = [...KNOWN];
  service.enqueueIdleBackfill();
  await settle();
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
