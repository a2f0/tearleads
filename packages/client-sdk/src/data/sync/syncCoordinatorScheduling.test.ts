import { expect, test } from "bun:test";
import { createDomainScope } from "../shared/domainScope";
import {
  getOrCreateDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "./syncCoordinator";

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
