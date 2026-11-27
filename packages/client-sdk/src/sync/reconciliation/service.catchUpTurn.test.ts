import { expect, test } from "bun:test";
import { CATCH_UP_TURN_WAIT_MS } from "./connectionCatchUp";
import {
  awaitingCrawl,
  createGate,
  createManualReconciliationClock,
  OWED_LANE_HOST_CONTAINER_IDS,
  recordingLane,
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

test("a full sweep takes over a lane queued while its tree is listed", async () => {
  const clock = createManualReconciliationClock();
  const fullTree = createGate();
  const rootTree = createGate();
  const wakes: string[] = [];
  const { crawl, host, listings, service } = awaitingCrawl({
    overrides: {
      ...recordingLane(wakes),
      clock,
      refreshRootTree: () => rootTree.wait,
      refreshTree: () => fullTree.wait,
    },
  });
  // Each lane is listed and unchanged, which leaves it undiscovered.
  host.discoverContainerDocuments = async (requests, onOutcome) => {
    listings.push(requests.map((request) => request.containerId));
    const outcomes = requests.map(({ containerId }) => ({
      containerId,
      status: "fulfilled" as const,
      value: null,
    }));
    for (const outcome of outcomes) await onOutcome(outcome);
    return outcomes;
  };
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();
  // A full refresh lists the tree, a root refresh waits behind it, and the
  // catch-up's turn comes after both.
  const fullRefresh = service.reconcileNow();
  const rootRefresh = service.reconcileRootContainersNow();
  crawl.open();
  await settle();
  // Lane a is queued while the full sweep lists the tree; the catch-up
  // holds it back from the lane.
  service.enqueueContainer("a", "idle");
  await settle();

  fullTree.open();
  await fullRefresh;
  expect(listings).toEqual([[...KNOWN]]);
  const wakesBefore = wakes.length;

  // The catch-up's turn is overdue, and what it held back is free: the full
  // sweep took lane a over and listed it, so nothing is left to list and
  // the lane is not woken.
  clock.advance(CATCH_UP_TURN_WAIT_MS);
  await settle();
  await settle();
  expect(listings).toEqual([[...KNOWN]]);
  expect(wakes.slice(wakesBefore)).toEqual([]);

  rootTree.open();
  await Promise.all([rootRefresh, catchUp]);
  service.stop();
});

test("a slow read of the plan does not make the catch-up overdue", async () => {
  const clock = createManualReconciliationClock();
  const read = createGate();
  const { host, listings, service } = awaitingCrawl({
    overrides: { clock, whenTreeCrawlSettles: async () => true },
  });
  let reads = 0;
  host.listOwedDocumentDiscoveryContainerIds = async (containerIds) => {
    reads += 1;
    if (reads === 1) return [];
    await read.wait;
    return containerIds.filter((id) => id === "a");
  };
  // The turn comes at once, and the plan's read of the owed record is slow.
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();
  service.enqueueContainer("a", "idle");
  await settle();

  // The turn came in time, so lane a still waits for the sweep's plan.
  clock.advance(CATCH_UP_TURN_WAIT_MS);
  await settle();
  await settle();
  expect(listings).toEqual([]);

  read.open();
  await catchUp;
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
