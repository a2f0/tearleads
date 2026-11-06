import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { createDomainScope } from "../shared/domainScope";
import {
  getDomainSyncCoordinatorSnapshot,
  getOrCreateDomainSyncCoordinator,
  hasDomainSyncCoordinatorPendingWork,
  waitForDomainSyncCoordinatorToSettle,
} from "./syncCoordinator";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("waitForDomainSyncCoordinatorToSettle waits for running lanes", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let releaseRun: () => void = () => {};
  let resolveStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });

  const lane = coordinator.registerLane("slow", {
    run: async () => {
      resolveStarted();
      await release;
    },
  });

  lane.requestSync();
  await started;

  let settled = false;
  const waitPromise = waitForDomainSyncCoordinatorToSettle(domainScope, {
    intervalMs: 1,
    quietMs: 0,
    timeoutMs: 100,
  }).then((result) => {
    settled = result;
  });

  await delay(5);
  expect(hasDomainSyncCoordinatorPendingWork(domainScope)).toBe(true);
  expect(settled).toBe(false);

  releaseRun();
  await waitPromise;

  expect(settled).toBe(true);
  expect(hasDomainSyncCoordinatorPendingWork(domainScope)).toBe(false);
});

test("waitForDomainSyncCoordinatorToSettle reports timeout while work remains", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let releaseRun: () => void = () => {};
  let resolveStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });

  coordinator
    .registerLane("blocked", {
      run: async () => {
        resolveStarted();
        await release;
      },
    })
    .requestSync();

  await started;

  const settled = await waitForDomainSyncCoordinatorToSettle(domainScope, {
    intervalMs: 1,
    quietMs: 0,
    timeoutMs: 5,
  });

  expect(settled).toBe(false);
  expect(hasDomainSyncCoordinatorPendingWork(domainScope)).toBe(true);

  releaseRun();
  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 1,
      quietMs: 0,
      timeoutMs: 100,
    }),
  ).toBe(true);
});

test("a run exceeding its watchdog frees the queue instead of blocking it", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let releaseStuckRun: () => void = () => {};
  const stuckRelease = new Promise<void>((resolve) => {
    releaseStuckRun = resolve;
  });
  let nextRan = false;

  const stuckLane = coordinator.registerLane("stuck", {
    phase: "structural",
    run: () => stuckRelease,
    watchdogMs: 20,
  });
  const nextLane = coordinator.registerLane("next", {
    run: async () => {
      nextRan = true;
    },
  });

  stuckLane.requestSync();
  nextLane.requestSync();

  // The structural watchdog releases the phase barrier for document work.
  await waitFor(() => nextRan, "Next lane never ran.", 2_000);

  const snapshot = getDomainSyncCoordinatorSnapshot(domainScope);
  const stuckSnapshot = snapshot.lanes.find((lane) => lane.key === "stuck");
  expect(stuckSnapshot?.status).toBe("error");
  expect(stuckSnapshot?.lastError).toContain("watchdog");
  expect(snapshot.lanes.find((lane) => lane.key === "next")?.status).toBe(
    "complete",
  );

  // The abandoned run's late settle overwrites the transient watchdog verdict
  // with the real outcome.
  releaseStuckRun();
  await waitFor(
    () => {
      const settled = getDomainSyncCoordinatorSnapshot(domainScope).lanes.find(
        (lane) => lane.key === "stuck",
      );
      return settled?.status === "complete" && settled.lastError === null;
    },
    "Stuck lane never settled after release.",
    2_000,
  );
});

test("a timed-out lane never runs concurrently with its abandoned run and resumes after it settles", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let runEntries = 0;
  let releaseFirstRun: () => void = () => {};
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirstRun = resolve;
  });

  const lane = coordinator.registerLane("re-requested", {
    run: async () => {
      runEntries += 1;
      if (runEntries === 1) {
        await firstRelease;
      }
    },
    watchdogMs: 20,
  });

  lane.requestSync();
  // Wait for the watchdog to abandon the first run...
  await waitFor(
    () =>
      getDomainSyncCoordinatorSnapshot(domainScope)
        .lanes.find((candidate) => candidate.key === "re-requested")
        ?.lastError?.includes("watchdog") === true,
    "Watchdog never abandoned the first run.",
    2_000,
  );

  // ...then re-request while the abandoned run is still live: selection must
  // hold the lane back rather than running it concurrently with itself.
  lane.requestSync();
  await delay(50);
  expect(runEntries).toBe(1);

  // Once the abandoned run settles, the queued re-request runs.
  releaseFirstRun();
  await waitFor(() => runEntries === 2, "Queued re-request never ran.", 2_000);
  await waitFor(
    () => {
      const settled = getDomainSyncCoordinatorSnapshot(domainScope).lanes.find(
        (candidate) => candidate.key === "re-requested",
      );
      return settled?.status === "complete";
    },
    "Re-requested lane never completed.",
    2_000,
  );
});
