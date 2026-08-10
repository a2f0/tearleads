import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { createDomainScope } from "../domainScope";
import {
  getDomainSyncCoordinatorSnapshot,
  getOrCreateDomainSyncCoordinator,
  hasDomainSyncCoordinatorPendingWork,
  subscribeToDomainSyncCoordinator,
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

test("structural lanes run before queued document lanes", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const calls: string[] = [];

  const documentLane = coordinator.registerLane("document", {
    phase: "document",
    run: async () => {
      calls.push("document");
    },
  });
  const structuralLane = coordinator.registerLane("structural", {
    phase: "structural",
    run: async () => {
      calls.push("structural");
    },
  });

  documentLane.requestSync();
  structuralLane.requestSync();

  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 1,
      quietMs: 0,
      timeoutMs: 100,
    }),
  ).toBe(true);
  expect(calls).toEqual(["structural", "document"]);
});

test("structural follow-up requests drain before document lanes", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const calls: string[] = [];
  let structuralRunCount = 0;
  let requestStructuralSync: () => void = () => {};

  const structuralLane = coordinator.registerLane("structural", {
    phase: "structural",
    run: async () => {
      structuralRunCount += 1;
      calls.push(`structural-${structuralRunCount}`);

      if (structuralRunCount === 1) {
        requestStructuralSync();
      }
    },
  });
  requestStructuralSync = structuralLane.requestSync;
  const documentLane = coordinator.registerLane("document", {
    phase: "document",
    run: async () => {
      calls.push("document");
    },
  });

  structuralLane.requestSync();
  documentLane.requestSync();

  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 1,
      quietMs: 0,
      timeoutMs: 100,
    }),
  ).toBe(true);
  expect(calls).toEqual(["structural-1", "structural-2", "document"]);
});

test("structural self-follow-up survives a throw in the same pass", async () => {
  // A no-onUnexpectedError lane (like the real container-contents structural
  // lane) re-throws into the coordinator catch block. If that pass armed a
  // self-follow-up before throwing, the follow-up must NOT be cleared — else
  // queued structural work is dropped and document lanes run on a stale
  // container topology (docs/client-sync-ordering.md). The existing tests cover
  // self-follow-up and throw only separately; this is their combination.
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const calls: string[] = [];
  let structuralRunCount = 0;
  let requestStructuralSync: () => void = () => {};
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const structuralLane = coordinator.registerLane("structural", {
      phase: "structural",
      run: async () => {
        structuralRunCount += 1;
        calls.push(`structural-${structuralRunCount}`);
        if (structuralRunCount === 1) {
          requestStructuralSync();
          throw new Error("transient structural failure");
        }
      },
    });
    requestStructuralSync = structuralLane.requestSync;
    const documentLane = coordinator.registerLane("document", {
      phase: "document",
      run: async () => {
        calls.push("document");
      },
    });

    structuralLane.requestSync();
    documentLane.requestSync();

    // Timeout exceeds FAILED_LANE_REARM_BACKOFF_MS: the re-armed structural
    // follow-up retries after the backoff (it failed + re-armed), so the pass
    // sequence completes ~1s later rather than immediately.
    expect(
      await waitForDomainSyncCoordinatorToSettle(domainScope, {
        intervalMs: 5,
        quietMs: 0,
        timeoutMs: 5000,
      }),
    ).toBe(true);
  } finally {
    console.error = originalConsoleError;
  }

  expect(calls).toEqual(["structural-1", "structural-2", "document"]);
  expect(structuralRunCount).toBe(2);
});

test("a failed lane that re-arms itself backs off and retries without tight-looping", async () => {
  // The companion to the test above: a lane that arms a self-follow-up and then
  // FAILS must still retry (the follow-up survives), but the retry must be
  // backed off rather than re-selected in a tight microtask loop that would
  // starve the event loop. Here the lane fails+re-arms once then succeeds; the
  // test completing (not timing out) plus the second run proves termination.
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const calls: string[] = [];
  let runCount = 0;
  let requestSelfSync: () => void = () => {};
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const flakyLane = coordinator.registerLane("flaky", {
      phase: "structural",
      run: async () => {
        runCount += 1;
        calls.push(`run-${runCount}`);
        if (runCount === 1) {
          requestSelfSync();
          throw new Error("transient self-rearming failure");
        }
      },
    });
    requestSelfSync = flakyLane.requestSync;
    flakyLane.requestSync();

    expect(
      await waitForDomainSyncCoordinatorToSettle(domainScope, {
        intervalMs: 5,
        quietMs: 0,
        timeoutMs: 5000,
      }),
    ).toBe(true);
  } finally {
    console.error = originalConsoleError;
  }

  expect(calls).toEqual(["run-1", "run-2"]);
  expect(runCount).toBe(2);
});

test("unexpected lane errors do not abort queued sync work", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const calls: string[] = [];
  const reportedErrors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    reportedErrors.push(args);
  };

  try {
    const failingLane = coordinator.registerLane("failing", {
      phase: "structural",
      run: async () => {
        calls.push("failing");
        throw new Error("boom");
      },
    });
    const documentLane = coordinator.registerLane("document", {
      phase: "document",
      run: async () => {
        calls.push("document");
      },
    });

    failingLane.requestSync();
    documentLane.requestSync();

    expect(
      await waitForDomainSyncCoordinatorToSettle(domainScope, {
        intervalMs: 1,
        quietMs: 0,
        timeoutMs: 100,
      }),
    ).toBe(true);
  } finally {
    console.error = originalConsoleError;
  }

  expect(calls).toEqual(["failing", "document"]);
  expect(reportedErrors[0]?.[0]).toBe("Failed to run sync lane failing:");
  expect(reportedErrors[0]?.[1]).toBeInstanceOf(Error);
});

test("sync coordinator snapshots report lane lifecycle telemetry", async () => {
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
  let notificationCount = 0;
  const unsubscribe = subscribeToDomainSyncCoordinator(domainScope, () => {
    notificationCount += 1;
  });

  const lane = coordinator.registerLane("slow", {
    label: "Slow lane",
    phase: "structural",
    run: async () => {
      resolveStarted();
      await release;
    },
  });

  expect(getDomainSyncCoordinatorSnapshot(domainScope).lanes[0]).toMatchObject({
    key: "slow",
    label: "Slow lane",
    lastAction: "registered",
    phase: "structural",
    status: "idle",
  });

  lane.requestSync();
  expect(getDomainSyncCoordinatorSnapshot(domainScope).lanes[0]).toMatchObject({
    lastAction: "requested",
    requestCount: 1,
    requested: true,
    status: "queued",
  });

  await started;
  expect(getDomainSyncCoordinatorSnapshot(domainScope).lanes[0]).toMatchObject({
    lastAction: "started",
    runCount: 1,
    running: true,
    status: "running",
  });

  releaseRun();
  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 1,
      quietMs: 0,
      timeoutMs: 100,
    }),
  ).toBe(true);

  const completedLane = getDomainSyncCoordinatorSnapshot(domainScope).lanes[0];
  expect(completedLane).toMatchObject({
    errorCount: 0,
    lastAction: "completed",
    requestCount: 1,
    requested: false,
    runCount: 1,
    running: false,
    status: "complete",
  });
  expect(completedLane?.lastCompletedAt).toBeTruthy();
  expect(notificationCount).toBeGreaterThanOrEqual(4);

  unsubscribe();
});

test("sync coordinator snapshots preserve handled lane errors", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const reportedErrors: unknown[] = [];

  coordinator
    .registerLane("failing", {
      onUnexpectedError: (error) => {
        reportedErrors.push(error);
      },
      run: async () => {
        throw new Error("boom");
      },
    })
    .requestSync();

  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 1,
      quietMs: 0,
      timeoutMs: 100,
    }),
  ).toBe(true);

  expect(reportedErrors[0]).toBeInstanceOf(Error);
  const failedLane = getDomainSyncCoordinatorSnapshot(domainScope).lanes[0];
  expect(failedLane).toMatchObject({
    errorCount: 1,
    key: "failing",
    lastAction: "failed",
    lastError: "boom",
    status: "error",
  });
  expect(failedLane?.lastFailedAt).toBeTruthy();
});

test("sync coordinator subscriptions ignore listener failures", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let notifications = 0;
  let runs = 0;

  coordinator.subscribe(() => {
    throw new Error("listener failed");
  });
  coordinator.subscribe(() => {
    notifications += 1;
  });

  const requestSync = coordinator.registerLane("observable", {
    run: async () => {
      runs += 1;
    },
  }).requestSync;

  requestSync();

  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 1,
      quietMs: 0,
      timeoutMs: 100,
    }),
  ).toBe(true);
  expect(notifications).toBeGreaterThan(0);
  expect(runs).toBe(1);
});

test("sync coordinator subscriptions snapshot listeners before notifying", () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let firstNotifications = 0;
  let secondNotifications = 0;
  let unsubscribeSecond = () => {};

  coordinator.subscribe(() => {
    firstNotifications += 1;
    unsubscribeSecond();
  });
  unsubscribeSecond = coordinator.subscribe(() => {
    secondNotifications += 1;
  });

  coordinator.registerLane("observable", {
    run: async () => {},
  });

  expect(firstNotifications).toBe(1);
  expect(secondNotifications).toBe(1);
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

  // The stuck lane is selected first (registration order) and holds the pump
  // only until its watchdog fires; the queue then drains past it.
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
