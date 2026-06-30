import { expect, test } from "bun:test";
import { createDomainScope } from "../domainScope";
import {
  disposeDomainSyncCoordinator,
  getOrCreateDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "./syncCoordinator";

test("dispose force-stops a self-re-arming lane and the coordinator settles", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let runCount = 0;
  let requestSelf: () => void = () => {};

  const lane = coordinator.registerLane("dispose-rearm", {
    run: async () => {
      runCount += 1;
      if (runCount >= 3) {
        // Tear down mid-spin. Without the force-stop this lane re-arms forever.
        disposeDomainSyncCoordinator(domainScope);
        return;
      }
      requestSelf();
    },
  });
  requestSelf = lane.requestSync;
  lane.requestSync();

  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 5,
      quietMs: 0,
      timeoutMs: 5_000,
    }),
  ).toBe(true);

  const runCountAfterSettle = runCount;
  // A disposed pump must not run again across several macrotasks.
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(runCount).toBe(runCountAfterSettle);
  expect(runCount).toBe(3);
});

test("a disposed coordinator ignores new lane requests", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let runCount = 0;
  const lane = coordinator.registerLane("post-dispose", {
    run: async () => {
      runCount += 1;
    },
  });

  disposeDomainSyncCoordinator(domainScope);
  lane.requestSync();

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(runCount).toBe(0);
  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      timeoutMs: 1_000,
    }),
  ).toBe(true);
});

test("getOrCreate after dispose builds a fresh, working coordinator", async () => {
  const domainScope = createDomainScope();
  const first = getOrCreateDomainSyncCoordinator(domainScope);
  disposeDomainSyncCoordinator(domainScope);

  // Mirrors a React remount of the same scope: a new coordinator must run.
  const second = getOrCreateDomainSyncCoordinator(domainScope);
  expect(second).not.toBe(first);

  let ran = false;
  const lane = second.registerLane("fresh", {
    run: async () => {
      ran = true;
    },
  });
  lane.requestSync();

  await waitForDomainSyncCoordinatorToSettle(domainScope, { timeoutMs: 1_000 });
  expect(ran).toBe(true);
});
