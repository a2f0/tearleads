import { expect, test } from "bun:test";
import { createDomainScope } from "../domainScope";
import {
  beginDomainSyncUploadLane,
  getDomainSyncCoordinatorSnapshot,
  getOrCreateDomainSyncCoordinator,
  hasDomainSyncCoordinatorPendingWork,
  isDestroyedDatabaseClientError,
  subscribeToDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "./syncCoordinator";
import type { SyncLaneProgress } from "./syncTelemetry";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("isDestroyedDatabaseClientError follows wrapped error causes", () => {
  expect(
    isDestroyedDatabaseClientError(
      new Error("Failed query", {
        cause: new Error("Database worker client has been destroyed."),
      }),
    ),
  ).toBe(true);
});

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

test("isDestroyedDatabaseClientError detects wrapped teardown messages", () => {
  expect(
    isDestroyedDatabaseClientError(
      new Error(
        "Failed to sync document: Database worker client has been destroyed.",
      ),
    ),
  ).toBe(true);
});

function findLane(
  domainScope: ReturnType<typeof createDomainScope>,
  key: string,
) {
  return getDomainSyncCoordinatorSnapshot(domainScope).lanes.find(
    (lane) => lane.key === key,
  );
}

test("upload lanes report running, progress, and completion", () => {
  const domainScope = createDomainScope();
  const progress: SyncLaneProgress = {
    bytesTotal: 100,
    bytesUploaded: 40,
    partsCompleted: 2,
    partsTotal: 5,
  };

  const lane = beginDomainSyncUploadLane(domainScope, "blob-upload:slot-1", {
    label: "Upload report.pdf",
  });

  const started = findLane(domainScope, "blob-upload:slot-1");
  expect(started?.phase).toBe("blob");
  expect(started?.label).toBe("Upload report.pdf");
  expect(started?.status).toBe("running");
  expect(started?.progress).toBeNull();

  lane.reportProgress(progress);
  expect(findLane(domainScope, "blob-upload:slot-1")?.progress).toEqual(
    progress,
  );

  lane.complete();
  const completed = findLane(domainScope, "blob-upload:slot-1");
  expect(completed?.status).toBe("complete");
  // Completion snaps progress to the full payload regardless of last report.
  expect(completed?.progress).toEqual({
    bytesTotal: 100,
    bytesUploaded: 100,
    partsCompleted: 5,
    partsTotal: 5,
  });
});

test("failed upload lanes surface the error", () => {
  const domainScope = createDomainScope();
  const lane = beginDomainSyncUploadLane(domainScope, "blob-upload:slot-2");

  lane.fail(new Error("part rejected"));

  const failed = findLane(domainScope, "blob-upload:slot-2");
  expect(failed?.status).toBe("error");
  expect(failed?.lastError).toBe("part rejected");
  expect(failed?.errorCount).toBe(1);
});

test("upload lanes are ignored by the coordinator pump", async () => {
  const domainScope = createDomainScope();
  const lane = beginDomainSyncUploadLane(domainScope, "blob-upload:slot-3");

  // An observational upload lane is never `requested`, so it is not pending
  // pump work even while running, and waitForIdle settles immediately.
  expect(hasDomainSyncCoordinatorPendingWork(domainScope)).toBe(true);
  lane.complete();
  expect(hasDomainSyncCoordinatorPendingWork(domainScope)).toBe(false);
  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 1,
      timeoutMs: 50,
    }),
  ).toBe(true);
});

test("a stale upload lane handle cannot clobber a newer session", () => {
  const domainScope = createDomainScope();
  const stale = beginDomainSyncUploadLane(domainScope, "blob-upload:slot-r");
  // Re-begin the same lane key (e.g. a retried upload) — this advances the
  // session and the stale handle's calls should become no-ops.
  const current = beginDomainSyncUploadLane(domainScope, "blob-upload:slot-r");

  stale.complete();
  expect(findLane(domainScope, "blob-upload:slot-r")?.status).toBe("running");

  current.complete();
  expect(findLane(domainScope, "blob-upload:slot-r")?.status).toBe("complete");
});

test("completed upload lanes are capped to the retention limit", () => {
  const domainScope = createDomainScope();

  for (let index = 0; index < 14; index += 1) {
    beginDomainSyncUploadLane(
      domainScope,
      `blob-upload:slot-${index}`,
    ).complete();
  }

  const uploadLanes = getDomainSyncCoordinatorSnapshot(
    domainScope,
  ).lanes.filter((lane) => lane.phase === "blob");
  expect(uploadLanes).toHaveLength(10);
  // The oldest lanes are evicted; the most recent survive.
  expect(uploadLanes.some((lane) => lane.key === "blob-upload:slot-0")).toBe(
    false,
  );
  expect(uploadLanes.some((lane) => lane.key === "blob-upload:slot-13")).toBe(
    true,
  );
});
