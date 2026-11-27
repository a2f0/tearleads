import { expect, test } from "bun:test";
import { awaitingCrawl, createGate } from "./service.testFixtures";

const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

/** A catch-up whose crawl does not complete once the test opens `crawl`. */
function awaitingIncompleteCrawl(
  overrides: Parameters<typeof awaitingCrawl>[0]["overrides"] = {},
) {
  const fixture = awaitingCrawl({ overrides });
  fixture.host.whenTreeCrawlSettles = async () => {
    await fixture.crawl.wait;
    return false;
  };
  return fixture;
}

test("a catch-up nothing vouches for skips a lane listed since its acknowledgement", async () => {
  const { crawl, listings, service } = awaitingIncompleteCrawl();
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();
  // A hint's listing of lane a is sent after the acknowledgement.
  service.enqueueContainer("a", "active", true);
  await settle();
  await settle();
  expect(listings).toEqual([["a"]]);

  crawl.open();
  await catchUp;

  // No crawl vouches for b and c; the hint's listing already read a.
  expect(listings).toEqual([["a"], ["b", "c"]]);
  service.stop();
});

test("a listing sent before an acknowledgement the wait shares vouches for nothing", async () => {
  const { crawl, host, listings, service } = awaitingIncompleteCrawl();
  const discover = host.discoverContainerDocuments;
  const answer = createGate();
  // The second listing is answered when the test says.
  host.discoverContainerDocuments = async (...args) => {
    const outcomes = await discover(...args);
    if (listings.length === 2) await answer.wait;
    return outcomes;
  };
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();
  // Lane b's listing is answered before the second acknowledgement, and lane
  // a's is still out when it arrives.
  for (const containerId of ["b", "a"]) {
    service.enqueueContainer(containerId, "active", true);
    await settle();
    await settle();
  }
  expect(listings).toEqual([["b"], ["a"]]);

  // The socket dropped and came back after both were sent: a write made
  // meanwhile may be missing from either.
  const shared = service.reconcileAcknowledgedConnection();
  answer.open();
  await settle();
  await settle();
  crawl.open();
  await Promise.all([catchUp, shared]);

  expect(listings).toEqual([["b"], ["a"], ["a", "b", "c"]]);
  service.stop();
});

test("a lane a hint forced since its listing is listed all the same", async () => {
  let online = true;
  const { crawl, listings, service } = awaitingIncompleteCrawl({
    getRuntimeStatus: () => ({
      dbStatus: "ready",
      isAuthenticated: true,
      online,
    }),
  });
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();
  await service.reconcileNow();
  expect(listings).toEqual([["a", "b", "c"]]);
  // The hint lands while the lane cannot run, so it is still owed when the
  // catch-up plans.
  online = false;
  service.enqueueContainer("b", "active", true);
  await settle();
  online = true;

  crawl.open();
  await catchUp;

  expect(listings).toEqual([["a", "b", "c"], ["b"]]);
  service.stop();
});

test("an owed record that cannot be read leaves the lanes listed since", async () => {
  const errors: unknown[] = [];
  const failure = new Error("owed record unreadable");
  const { crawl, host, listings, service } = awaitingCrawl({
    overrides: {
      logError: (_message, error) => {
        errors.push(error);
      },
    },
  });
  let reads = 0;
  // The release at the acknowledgement finds nothing owed; the plan's own
  // read fails, so nothing vouches.
  host.listOwedDocumentDiscoveryContainerIds = async () => {
    reads += 1;
    if (reads === 1) return [];
    throw failure;
  };
  const catchUp = service.reconcileAcknowledgedConnection();
  await settle();
  await service.reconcileNow();

  crawl.open();
  await catchUp;

  expect(listings).toEqual([["a", "b", "c"]]);
  expect(errors).toEqual([failure]);
  service.stop();
});
