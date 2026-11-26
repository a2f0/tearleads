import { expect, test } from "bun:test";
import {
  awaitingCrawl,
  createGate,
  OWED_LANE_HOST_CONTAINER_IDS,
} from "./service.testFixtures";

const KNOWN = OWED_LANE_HOST_CONTAINER_IDS;

const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

test("an acknowledgement while a catch-up awaits its turn gets its own crawl", async () => {
  const rootTree = createGate();
  let crawls = 0;
  const secondCrawl = createGate();
  let owed: ReadonlyArray<string> = [];
  const { listings, service } = awaitingCrawl({
    overrides: {
      refreshRootTree: () => rootTree.wait,
      whenTreeCrawlSettles: async () => {
        crawls += 1;
        if (crawls > 1) await secondCrawl.wait;
        return true;
      },
    },
    owed: () => owed,
  });
  // A root refresh holds the turn, so the first catch-up waits for it with
  // its crawl already settled.
  const rootRefresh = service.reconcileRootContainersNow();
  await settle();
  const first = service.reconcileAcknowledgedConnection();
  await settle();

  // The socket drops and is acknowledged again; its crawl is served lane b.
  const second = service.reconcileAcknowledgedConnection();
  expect(second).not.toBe(first);
  rootTree.open();
  await Promise.all([rootRefresh, first]);
  expect(listings).toEqual([]);

  owed = ["b"];
  secondCrawl.open();
  await second;
  expect(listings).toEqual([["b"]]);
  service.stop();
});

/**
 * A service whose first catch-up awaits its turn behind a root refresh that
 * the test releases, with its crawl settled complete, and whose second
 * acknowledgement's crawl is the test's to settle.
 */
async function supersededCatchUp(secondCrawl: Promise<boolean>) {
  const rootTree = createGate();
  let crawls = 0;
  const fixture = awaitingCrawl({
    overrides: {
      refreshRootTree: () => rootTree.wait,
      whenTreeCrawlSettles: () => {
        crawls += 1;
        return crawls === 1 ? Promise.resolve(true) : secondCrawl;
      },
    },
  });
  const { service } = fixture;
  const rootRefresh = service.reconcileRootContainersNow().catch(() => {});
  await settle();
  const first = service.reconcileAcknowledgedConnection().catch(() => {});
  await settle();
  const second = service.reconcileAcknowledgedConnection().catch(() => {});
  await settle();
  return { ...fixture, first, rootRefresh, rootTree, second };
}

test("a later catch-up never plans from an earlier crawl's verdict", async () => {
  // The second acknowledgement's crawl does not complete: nothing vouches.
  const { first, listings, rootRefresh, rootTree, second, service } =
    await supersededCatchUp(Promise.resolve(false));

  rootTree.open();
  await Promise.all([rootRefresh, first, second]);

  // The first crawl vouched for every lane, but that was another
  // connection: the superseded sweep lists nothing and vouches for nothing.
  expect(listings).toEqual([[...KNOWN]]);
  service.stop();
});

test("a superseded catch-up is dropped with the session too", async () => {
  const { first, listings, rootRefresh, rootTree, second, service } =
    await supersededCatchUp(new Promise<boolean>(() => undefined));

  service.stop();
  service.start();
  rootTree.open();
  await Promise.all([rootRefresh, first, second]);
  await settle();

  // Neither catch-up's crawl is the new session's knowledge.
  service.enqueueContainer("a", "idle");
  await settle();
  await settle();
  expect(listings).toEqual([["a"]]);
  service.stop();
});

test("a catch-up superseded while it reads the owed record lists nothing", async () => {
  const read = createGate();
  let crawls = 0;
  const secondCrawl = createGate();
  const { host, listings, service } = awaitingCrawl({
    overrides: {
      whenTreeCrawlSettles: async () => {
        crawls += 1;
        if (crawls > 1) await secondCrawl.wait;
        return true;
      },
    },
  });
  let reads = 0;
  host.listOwedDocumentDiscoveryContainerIds = async () => {
    reads += 1;
    if (reads === 1) await read.wait;
    return reads === 1 ? ["a"] : ["b"];
  };
  const first = service.reconcileAcknowledgedConnection().catch(() => {});
  await settle();
  expect(reads).toBe(1);

  // A second acknowledgement arrives while the first sweep reads what is
  // owed: that sweep's crawl is about a connection that is over.
  const second = service.reconcileAcknowledgedConnection().catch(() => {});
  read.open();
  await first;
  expect(listings).toEqual([]);

  secondCrawl.open();
  await second;
  expect(listings).toEqual([["b"]]);
  service.stop();
});

test("a superseded catch-up takes no hint out of the queue", async () => {
  // The second acknowledgement's crawl never settles in this test.
  const { first, listings, rootRefresh, rootTree, service } =
    await supersededCatchUp(new Promise<boolean>(() => undefined));

  // A hint is queued just as the superseded sweep's turn comes, before the
  // lane has run for it.
  service.enqueueContainer("b", "active", true);
  rootTree.open();
  await Promise.all([rootRefresh, first]);
  await settle();
  await settle();

  // The sweep listed nothing and never read a plan, so the hint it took
  // over goes back to the lane at once, not after a retry backoff.
  expect(listings).toEqual([["b"]]);
  service.stop();
});
