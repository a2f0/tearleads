import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/shared/domainScope";
import { getOrCreateDomainSyncCoordinator } from "../../data/sync/syncCoordinator";
import { awaitingCrawl, createGate } from "./service.testFixtures";

const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

/**
 * A started service whose first catch-up's release of lanes already owed
 * waits for `release` and then answers `owed`; every later read finds
 * nothing owed at once. It counts each request to run the lane.
 */
function awaitingRelease(input: {
  readonly owed: () => ReadonlyArray<string>;
  readonly logError?: (message: string, error: unknown) => void;
}) {
  const release = createGate();
  const domainScope = createDomainScope();
  let wakes = 0;
  const fixture = awaitingCrawl({
    overrides: {
      domainScope,
      logError: input.logError,
      registerLane: (key, config) => {
        const lane = getOrCreateDomainSyncCoordinator(domainScope).registerLane(
          key,
          config,
        );
        return {
          ...lane,
          requestSync: () => {
            wakes += 1;
            lane.requestSync();
          },
        };
      },
    },
  });
  let reads = 0;
  fixture.host.listOwedDocumentDiscoveryContainerIds = async () => {
    reads += 1;
    if (reads > 1) return [];
    await release.wait;
    return input.owed();
  };
  return { ...fixture, release, wakes: () => wakes };
}

test("a release that frees nothing queued leaves the lane asleep", async () => {
  const { crawl, listings, release, service, wakes } = awaitingRelease({
    owed: () => ["c"],
  });
  const catchUp = service.reconcileAcknowledgedConnection();
  service.enqueueContainer("a", "idle");
  await settle();
  const before = wakes();

  // Lane c is owed but not queued, and lane a is still deferred: a wake now
  // would only cut short a failed lane's retry backoff.
  release.open();
  await settle();
  expect(wakes()).toBe(before);
  expect(listings).toEqual([]);

  crawl.open();
  await catchUp;
  service.stop();
});

test("a release that frees a queued lane wakes the lane for it", async () => {
  const { crawl, listings, release, service } = awaitingRelease({
    owed: () => ["a"],
  });
  const catchUp = service.reconcileAcknowledgedConnection();
  service.enqueueContainer("a", "idle");
  await settle();
  expect(listings).toEqual([]);

  release.open();
  await settle();
  await settle();
  expect(listings).toEqual([["a"]]);

  crawl.open();
  await catchUp;
  service.stop();
});

test("a failed read of the lanes already owed is reported", async () => {
  const errors: unknown[] = [];
  const failure = new Error("owed record unreadable");
  const { crawl, listings, release, service } = awaitingRelease({
    logError: (_message, error) => {
      errors.push(error);
    },
    owed: () => {
      throw failure;
    },
  });
  const catchUp = service.reconcileAcknowledgedConnection();
  release.open();
  await settle();
  expect(errors).toEqual([failure]);

  // The lanes wait for the sweep, whose own read succeeds.
  crawl.open();
  await catchUp;
  expect(listings).toEqual([]);
  service.stop();
});

test("a release read that answers after a stop and restart frees nothing", async () => {
  const { listings, release, service } = awaitingRelease({
    owed: () => ["a"],
  });
  void service.reconcileAcknowledgedConnection();
  await settle();

  // The new session's catch-up defers lane a, which nothing owes now.
  service.stop();
  service.start();
  const catchUp = service.reconcileAcknowledgedConnection();
  service.enqueueContainer("a", "idle");
  await settle();

  // The old session's answer is about its own acknowledgement.
  release.open();
  await settle();
  await settle();
  expect(listings).toEqual([]);
  service.stop();
  await catchUp;
});

test("a release read that answers after a supersede frees nothing", async () => {
  const rootTree = createGate();
  const { crawl, host, listings, release, service } = awaitingRelease({
    owed: () => ["a"],
  });
  host.refreshRootTree = () => rootTree.wait;
  const first = service.reconcileAcknowledgedConnection();
  await settle();
  // The first catch-up's crawl settles behind a stuck root refresh, and a
  // second acknowledgement supersedes it before its old read answers.
  const rootRefresh = service.reconcileRootContainersNow();
  crawl.open();
  await settle();
  const second = service.reconcileAcknowledgedConnection();
  service.enqueueContainer("a", "idle");
  await settle();
  expect(listings).toEqual([]);

  release.open();
  await settle();
  await settle();
  // The answer is about the first acknowledgement; lane a waits for the
  // second one's sweep, which the crawl vouches for.
  expect(listings).toEqual([]);
  rootTree.open();
  await Promise.all([rootRefresh, first, second]);
  await settle();
  expect(listings).toEqual([]);
  service.stop();
});
