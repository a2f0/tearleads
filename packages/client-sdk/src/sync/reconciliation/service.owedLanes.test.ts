import { expect, test } from "bun:test";
import { createReconciliationService } from "./service";
import {
  createGate,
  createManualReconciliationClock,
  createOwedLaneHost,
  OWED_LANE_HOST_CONTAINER_IDS,
} from "./service.testFixtures";
import { TREE_CRAWL_WAIT_MS } from "./treeCrawlWait";

const KNOWN = OWED_LANE_HOST_CONTAINER_IDS;

const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

test("a catch-up whose tree crawl completed lists the owed lanes alone", async () => {
  const { host, listings, steps } = createOwedLaneHost({
    overrides: { whenTreeCrawlSettles: async () => true },
    owed: () => ["b"],
  });
  const service = createReconciliationService(host);
  service.start();

  await service.reconcileAcknowledgedConnection();

  expect(listings).toEqual([["b"]]);
  // It still ends by asking for the reads its listings owed.
  expect(steps).toEqual(["owed-reads"]);

  // The crawl vouched for the other lanes: they count as reconciled, so a
  // passive enqueue lists neither of them again this session.
  for (const containerId of ["a", "c"]) {
    service.enqueueContainer(containerId, "idle");
  }
  await settle();
  expect(listings).toEqual([["b"]]);
  // A hint still forces a vouched lane.
  service.enqueueContainer("a", "active", true);
  await settle();
  await settle();
  expect(listings).toEqual([["b"], ["a"]]);
  service.stop();
});

test("a catch-up with nothing owed and a complete crawl sends no listing", async () => {
  const { host, listings, steps } = createOwedLaneHost({
    overrides: { whenTreeCrawlSettles: async () => true },
    owed: () => [],
  });
  const service = createReconciliationService(host);

  await service.reconcileAcknowledgedConnection();

  expect(listings).toEqual([]);
  expect(steps).toEqual(["owed-reads"]);
});

test.each([
  ["did not complete", { whenTreeCrawlSettles: async () => false }],
  ["is not reported by the host", {}],
])(
  "a catch-up whose tree crawl %s lists every known lane",
  async (_name, overrides) => {
    const { host, listings } = createOwedLaneHost({
      overrides,
      owed: () => ["b"],
    });
    const service = createReconciliationService(host);

    await service.reconcileAcknowledgedConnection();

    expect(listings).toEqual([[...KNOWN]]);
  },
);

test("a catch-up waits for the tree crawl, holding passive listings of known lanes", async () => {
  const crawl = createGate();
  let owed: ReadonlyArray<string> = [];
  const { host, listings } = createOwedLaneHost({
    overrides: {
      whenTreeCrawlSettles: async () => {
        await crawl.wait;
        return true;
      },
    },
    owed: () => owed,
  });
  const service = createReconciliationService(host);
  service.start();

  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();
  // Coming back online also queued every known lane for an idle listing.
  for (const containerId of KNOWN)
    service.enqueueContainer(containerId, "idle");
  await settle();
  expect(listings).toEqual([]);

  // The crawl is served lane c's row and owes it a listing, then completes.
  owed = ["c"];
  crawl.open();
  await catchUp;
  await settle();

  expect(listings).toEqual([["c"]]);
  service.stop();
});

test("a catch-up that cannot read what is owed lists every known lane", async () => {
  const errors: unknown[] = [];
  const failure = new Error("database busy");
  let fail = false;
  const { host, listings } = createOwedLaneHost({
    overrides: {
      logError: (_message, error) => {
        errors.push(error);
      },
      whenTreeCrawlSettles: async () => true,
    },
    owed: () => {
      if (fail) throw failure;
      return [];
    },
  });
  const service = createReconciliationService(host);
  service.start();

  // An earlier catch-up vouched for every lane, so none is queued or held.
  await service.reconcileAcknowledgedConnection();
  expect(listings).toEqual([]);

  // Nothing says which lanes this crawl owed, so nothing vouches for any.
  fail = true;
  await service.reconcileAcknowledgedConnection();

  expect(listings).toEqual([[...KNOWN]]);
  expect(errors).toEqual([failure]);
  service.stop();
});

test("a catch-up whose database is gone lists nothing and reports nothing", async () => {
  const errors: unknown[] = [];
  const gone = new Error("database closed");
  const { host, listings } = createOwedLaneHost({
    overrides: {
      isIgnorableError: (error) => error === gone,
      logError: (_message, error) => {
        errors.push(error);
      },
      whenTreeCrawlSettles: async () => true,
    },
    owed: () => {
      throw gone;
    },
  });
  const service = createReconciliationService(host);

  await service.reconcileAcknowledgedConnection();

  expect(listings).toEqual([]);
  expect(errors).toEqual([]);
});

test("a catch-up that outlives its session leaves the next one's lanes alone", async () => {
  const crawl = createGate();
  const { host, listings } = createOwedLaneHost({
    overrides: {
      whenTreeCrawlSettles: async () => {
        await crawl.wait;
        return true;
      },
    },
    owed: () => [],
  });
  const service = createReconciliationService(host);
  service.start();
  const catchUp = service.reconcileAcknowledgedConnection().catch(() => {});
  await settle();

  // The session ends and another begins while the plan waits on the crawl.
  service.stop();
  service.start();
  crawl.open();
  await catchUp;
  await settle();

  // The old sweep's crawl vouched for every lane; that is not the new
  // session's knowledge, so a passive enqueue still lists.
  service.enqueueContainer("a", "idle");
  await settle();
  await settle();
  expect(listings).toEqual([["a"]]);
  service.stop();
});

test("an open container the reconciler does not list in the background is always listed", async () => {
  const { host, listings } = createOwedLaneHost({
    overrides: {
      canDiscoverContainerDocuments: () => true,
      whenTreeCrawlSettles: async () => true,
    },
    owed: () => [],
  });
  const service = createReconciliationService(host);
  // Another organization's system folder, open in Explorer: no owed-lane
  // record covers it, so a complete crawl vouches for the others alone.
  service.setActiveContainer("foreign");
  await service.reconcileAcknowledgedConnection();

  expect(listings).toEqual([["foreign"]]);
});

test("a refresh runs beside a catch-up that waits on its crawl", async () => {
  const clock = createManualReconciliationClock();
  const { host, listings } = createOwedLaneHost({
    overrides: {
      clock,
      // The crawl never starts: the socket dropped again.
      whenTreeCrawlSettles: () => new Promise<boolean>(() => undefined),
    },
    owed: () => [],
  });
  const service = createReconciliationService(host);
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();
  expect(listings).toEqual([]);

  // The wait takes no turn among the sweeps, so the refresh does not queue
  // behind it and has no need to end it.
  await service.reconcileNow();
  expect(listings).toEqual([[...KNOWN]]);

  // Once the wait is over nothing vouches for the catch-up's lanes.
  clock.advance(TREE_CRAWL_WAIT_MS);
  await catchUp;
  expect(listings).toEqual([[...KNOWN], [...KNOWN]]);
});
