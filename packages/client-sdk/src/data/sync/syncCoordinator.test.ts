import { expect, test } from "bun:test";
import { createDomainScope } from "../domainScope";
import {
  getOrCreateDomainSyncCoordinator,
  hasDomainSyncCoordinatorPendingWork,
  isDestroyedDatabaseClientError,
  waitForDomainSyncCoordinatorToSettle,
} from "./syncCoordinator";

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

test("isDestroyedDatabaseClientError detects wrapped teardown messages", () => {
  expect(
    isDestroyedDatabaseClientError(
      new Error(
        "Failed to sync document: Database worker client has been destroyed.",
      ),
    ),
  ).toBe(true);
});
