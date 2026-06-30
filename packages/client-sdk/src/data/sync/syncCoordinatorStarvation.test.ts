import { expect, test } from "bun:test";
import { createDomainScope } from "../domainScope";
import {
  getOrCreateDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "./syncCoordinator";

test("the pump yields a macrotask when a lane re-arms-and-completes", async () => {
  // Regression for success-path self-re-arm starvation. runRequestedSyncLanes
  // used to yield a macrotask (delay) only on the failed-and-re-armed path, so a
  // lane that COMPLETES but re-arms itself on microtask-resolving work spun the
  // while(true) pump without ever yielding the event loop — starving the
  // macrotask/timer phase (a test's setTimeout timeout, a waitFor poll). That
  // surfaced as a 30s-timeout pane test running ~319s under full-suite load,
  // because a leaked spinning pump from an earlier test starved every later
  // test's timers. This pins that the pump now yields a macrotask between
  // self-re-arm passes.
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  // Bounded so this test can never itself hang on the unfixed code; the bug is
  // detected by WHEN the macrotask runs, not by a true infinite loop.
  const REARM_LIMIT = 200;
  let runCount = 0;
  let runCountWhenMacrotaskFired = -1;
  let requestSelf: () => void = () => {};

  const lane = coordinator.registerLane("self-rearm-success", {
    run: async () => {
      runCount += 1;
      // Re-arm AND complete (never throw) on purely microtask-resolving work,
      // exactly like a sync lane whose follow-up condition has not yet cleared.
      if (runCount < REARM_LIMIT) {
        requestSelf();
      }
    },
  });
  requestSelf = lane.requestSync;

  // A macrotask scheduled before the pump starts. If the pump spins on
  // microtasks only, this cannot run until the lane stops re-arming (runCount
  // === REARM_LIMIT); with a per-re-arm macrotask yield it runs after the first
  // pass.
  setTimeout(() => {
    runCountWhenMacrotaskFired = runCount;
  }, 0);

  lane.requestSync();

  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 5,
      quietMs: 0,
      timeoutMs: 5_000,
    }),
  ).toBe(true);

  expect(runCount).toBe(REARM_LIMIT);
  // The macrotask must have fired BEFORE the lane finished re-arming. On the
  // unfixed pump it fires at runCount === REARM_LIMIT (starved → fails); with the
  // macrotask yield it fires at runCount === 1.
  expect(runCountWhenMacrotaskFired).toBeGreaterThanOrEqual(0);
  expect(runCountWhenMacrotaskFired).toBeLessThan(REARM_LIMIT);
});
