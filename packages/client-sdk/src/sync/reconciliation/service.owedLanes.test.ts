import { expect, test } from "bun:test";
import { createReconciliationService } from "./service";
import {
  createGate,
  createReconciliationTestHost,
  perContainerDiscovery,
} from "./service.testFixtures";
import type { ReconciliationHost } from "./serviceTypes";

const KNOWN = ["a", "b", "c"] as const;

/**
 * A host with three known lanes, of which `owed` are owed a listing, that
 * records each batched listing request.
 */
function createOwedLaneHost(input: {
  readonly owed: () => ReadonlyArray<string>;
  readonly overrides?: Partial<ReconciliationHost>;
}) {
  const listings: string[][] = [];
  const steps: string[] = [];
  const host = createReconciliationTestHost({
    discoverContainerDocuments: async (requests, onOutcome) => {
      listings.push(requests.map((request) => request.containerId));
      const outcomes = requests.map(({ containerId }) => ({
        containerId,
        status: "fulfilled" as const,
        value: null,
      }));
      for (const outcome of outcomes) await onOutcome(outcome);
      return outcomes;
    },
    listKnownContainerIds: () => [...KNOWN],
    listOwedDocumentDiscoveryContainerIds: async () => input.owed(),
    requestOwedDocumentReads: async () => {
      steps.push("owed-reads");
    },
    ...input.overrides,
  });
  return { host, listings, steps };
}

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

test("a catch-up that cannot read what is owed releases the lanes it held", async () => {
  const errors: unknown[] = [];
  const failure = new Error("database busy");
  let fail = true;
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

  await expect(service.reconcileAcknowledgedConnection()).rejects.toBe(failure);
  expect(errors).toEqual([failure]);

  // Nothing vouched for the lanes, so a passive enqueue lists them.
  fail = false;
  service.enqueueContainer("a", "idle");
  await settle();
  await settle();
  expect(listings).toEqual([["a"]]);
  service.stop();
});

test("lanes owed outside a catch-up are listed on request", async () => {
  let owed: ReadonlyArray<string> = ["a"];
  const { host, listings, steps } = createOwedLaneHost({ owed: () => owed });
  const service = createReconciliationService(host);

  await service.reconcileOwedLanes();
  expect(listings).toEqual([["a"]]);
  expect(steps).toEqual(["owed-reads"]);

  // Nothing owed: no listing, and no lane is vouched for either.
  owed = [];
  await service.reconcileOwedLanes();
  expect(listings).toEqual([["a"]]);
  service.start();
  service.enqueueContainer("b", "idle");
  await settle();
  await settle();
  expect(listings).toEqual([["a"], ["b"]]);
  service.stop();
});

test("an owed-lane request joins a catch-up that has not read what is owed", async () => {
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

  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();
  // The crawl the catch-up waits for owes a lane and announces it.
  owed = ["b"];
  const announced = service.reconcileOwedLanes();
  crawl.open();
  await Promise.all([catchUp, announced]);

  // One sweep answered both.
  expect(listings).toEqual([["b"]]);
});

test("an owed-lane request queues behind a sweep that already read what is owed", async () => {
  const listing = createGate();
  let owed: ReadonlyArray<string> = ["a"];
  const listings: string[][] = [];
  const { host } = createOwedLaneHost({
    overrides: {
      discoverContainerDocuments: perContainerDiscovery(async (containerId) => {
        listings.push([containerId]);
        await listing.wait;
        return null;
      }),
    },
    owed: () => owed,
  });
  const service = createReconciliationService(host);

  const first = service.reconcileOwedLanes();
  await settle();
  expect(listings).toEqual([["a"]]);
  // Another tree listing owes lane b while the first sweep is listing lane a.
  owed = ["a", "b"];
  const second = service.reconcileOwedLanes();
  listing.open();
  await Promise.all([first, second]);

  // The first sweep never knew of lane b; the second lists what is owed now.
  expect(listings).toEqual([["a"], ["a"], ["b"]]);
});
