import { expect, test } from "bun:test";
import { CATCH_UP_TURN_WAIT_MS } from "./connectionCatchUp";
import {
  awaitingCrawl,
  createGate,
  createManualReconciliationClock,
  OWED_LANE_HOST_CONTAINER_IDS,
} from "./service.testFixtures";

const KNOWN = OWED_LANE_HOST_CONTAINER_IDS;

const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

test("a catch-up whose turn is overdue holds no lane back", async () => {
  const clock = createManualReconciliationClock();
  const rootTree = createGate();
  const { crawl, listings, service } = awaitingCrawl({
    overrides: { clock, refreshRootTree: () => rootTree.wait },
  });
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();
  // A root refresh takes the turn first, and its tree listing is stuck.
  const rootRefresh = service.reconcileRootContainersNow();
  crawl.open();
  await settle();
  service.enqueueContainer("a", "idle");
  await settle();
  await settle();

  // The crawl settled; lane a waits for the catch-up's turn, within bounds.
  clock.advance(CATCH_UP_TURN_WAIT_MS - 1);
  await settle();
  expect(listings).toEqual([]);
  clock.advance(1);
  await settle();
  await settle();
  expect(listings).toEqual([["a"]]);

  // The turn comes at last: the crawl vouches for the rest, and lane a has
  // been listed already.
  rootTree.open();
  await Promise.all([rootRefresh, catchUp]);
  await settle();
  expect(listings).toEqual([["a"]]);
  service.stop();
});

test("a lane queued while the plan is read is listed once, by the sweep", async () => {
  const read = createGate();
  const { host, listings, service } = awaitingCrawl({
    overrides: { whenTreeCrawlSettles: async () => true },
  });
  let reads = 0;
  host.listOwedDocumentDiscoveryContainerIds = async (containerIds) => {
    reads += 1;
    // The release at the acknowledgement finds nothing owed; the plan's own
    // read waits, and then finds lane a owed.
    if (reads === 1) return [];
    await read.wait;
    return containerIds.filter((id) => id === "a");
  };
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();
  service.enqueueContainer("a", "idle");
  await settle();
  expect(listings).toEqual([]);

  read.open();
  await catchUp;
  await settle();
  await settle();
  expect(listings).toEqual([["a"]]);
  service.stop();
});

test("a crawl wait the database closed under lists nothing and holds nothing back", async () => {
  const errors: unknown[] = [];
  const closed = new Error("database closed");
  const { listings, service } = awaitingCrawl({
    overrides: {
      isIgnorableError: (error) => error === closed,
      logError: (_message, error) => {
        errors.push(error);
      },
      whenTreeCrawlSettles: () => Promise.reject(closed),
    },
  });
  const catchUp = service.reconcileAcknowledgedConnection();
  service.enqueueContainer("a", "idle");

  await catchUp;
  await settle();
  await settle();

  // As when the plan finds the database closed: no sweep, no report, and
  // the lane is free to list what it holds.
  expect(listings).toEqual([["a"]]);
  expect(errors).toEqual([]);
  service.stop();
});

test("a root sweep during the wait lists a lane a hint forced", async () => {
  let online = false;
  const { listings, service } = awaitingCrawl({
    overrides: {
      getRuntimeStatus: () => ({
        dbStatus: "ready",
        isAuthenticated: true,
        online,
      }),
      listAutomaticRootCatchupContainerIds: () => [...KNOWN],
    },
  });
  void service.reconcileAcknowledgedConnection();
  await settle();
  // The hint lands while the lane cannot run, so only the root sweep can
  // list its lane.
  service.enqueueContainer("b", "active", true);
  online = true;

  await service.reconcileRootContainersNow();

  // The forced lane is listed; the lanes the catch-up waits on are not.
  expect(listings).toEqual([["b"]]);
  service.stop();
});
