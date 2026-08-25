import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import {
  didRegainSyncPrerequisites,
  disposeDomainSyncCoordinator,
  getDomainSyncCoordinatorSnapshot,
  getOrCreateDomainSyncCoordinator,
  isDatabaseUnavailableError,
  type SyncRuntimeStatus,
} from "../../data/sync/syncCoordinator";
import {
  registerDocumentSyncLane,
  requestDocumentSyncLaneAndWait,
} from "./syncLane";

function flushSyncLane() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForSyncLane(
  condition: () => boolean,
  timeoutMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for sync lane state");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

test("registerDocumentSyncLane registers a document lane by local id", async () => {
  const domainScope = createDomainScope();
  const calls: string[] = [];
  const firstLane = registerDocumentSyncLane({
    domainScope,
    localId: "local-1",
    run: async () => {
      calls.push("first");
    },
  });
  registerDocumentSyncLane({
    domainScope,
    localId: "local-1",
    run: async () => {
      calls.push("second");
    },
  });
  const otherLane = registerDocumentSyncLane({
    domainScope,
    localId: "local-2",
    run: async () => {
      calls.push("other");
    },
  });

  firstLane.requestSync();
  otherLane.requestSync();
  await flushSyncLane();

  expect(calls.sort()).toEqual(["other", "second"]);
});

test("requested document sync reports completion and failure", async () => {
  const domainScope = createDomainScope();
  let shouldFail = true;
  const lane = registerDocumentSyncLane({
    domainScope,
    localId: "profile-local-id",
    run: async () => {
      if (shouldFail) throw new Error("transient failure");
    },
  });
  const request = () => lane.requestSync();

  expect(
    await requestDocumentSyncLaneAndWait({
      didCompleteRequest: () => true,
      domainScope,
      localId: "profile-local-id",
      request,
    }),
  ).toBe(false);
  shouldFail = false;
  expect(
    await requestDocumentSyncLaneAndWait({
      didCompleteRequest: () => true,
      domainScope,
      localId: "profile-local-id",
      request,
    }),
  ).toBe(true);
  expect(getDomainSyncCoordinatorSnapshot(domainScope).lanes[0]?.runCount).toBe(
    2,
  );
});

test("requested document sync can be aborted while a pass is pending", async () => {
  const domainScope = createDomainScope();
  let finishRun: () => void = () => undefined;
  const pendingRun = new Promise<void>((resolve) => {
    finishRun = resolve;
  });
  const lane = registerDocumentSyncLane({
    domainScope,
    localId: "profile-local-id",
    run: () => pendingRun,
  });
  const abortController = new AbortController();
  const result = requestDocumentSyncLaneAndWait({
    didCompleteRequest: () => true,
    domainScope,
    localId: "profile-local-id",
    request: () => lane.requestSync(),
    signal: abortController.signal,
  });

  abortController.abort();
  expect(await result).toBe(false);
  finishRun();
});

test("a completed lane reports an unconsumed request as incomplete", async () => {
  const domainScope = createDomainScope();
  const lane = registerDocumentSyncLane({
    domainScope,
    localId: "profile-local-id",
    run: async () => undefined,
  });

  expect(
    await requestDocumentSyncLaneAndWait({
      didCompleteRequest: () => false,
      domainScope,
      localId: "profile-local-id",
      request: () => lane.requestSync(),
    }),
  ).toBe(false);
});

test("a watchdog-abandoned lane rejects an immediate retry", async () => {
  const domainScope = createDomainScope();
  let finishRun: () => void = () => undefined;
  const pendingRun = new Promise<void>((resolve) => {
    finishRun = resolve;
  });
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const lane = coordinator.registerLane("documents:profile-local-id", {
    run: () => pendingRun,
    watchdogMs: 20,
  });
  lane.requestSync();
  await waitForSyncLane(
    () =>
      getDomainSyncCoordinatorSnapshot(domainScope).lanes[0]?.runAbandoned ===
      true,
  );
  let requested = false;

  expect(
    await requestDocumentSyncLaneAndWait({
      didCompleteRequest: () => true,
      domainScope,
      localId: "profile-local-id",
      request: () => {
        requested = true;
        lane.requestSync();
      },
    }),
  ).toBe(false);
  expect(requested).toBe(false);

  finishRun();
  await waitForSyncLane(
    () =>
      getDomainSyncCoordinatorSnapshot(domainScope).lanes[0]?.runAbandoned ===
      false,
  );
  expect(
    await requestDocumentSyncLaneAndWait({
      didCompleteRequest: () => true,
      domainScope,
      localId: "profile-local-id",
      request: () => lane.requestSync(),
    }),
  ).toBe(true);
});

test("a watchdog-abandoned wait invalidates before its late run settles", async () => {
  const domainScope = createDomainScope();
  let generation = 0;
  let invalidationCount = 0;
  let persistedLateResponse = false;
  let markRunStarted: () => void = () => undefined;
  const runStarted = new Promise<void>((resolve) => {
    markRunStarted = resolve;
  });
  let releaseRun: () => void = () => undefined;
  const runGate = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const lane = coordinator.registerLane("documents:profile-local-id", {
    run: async () => {
      const runGeneration = generation;
      markRunStarted();
      await runGate;
      if (runGeneration === generation) {
        persistedLateResponse = true;
      }
    },
    watchdogMs: 20,
  });
  const result = requestDocumentSyncLaneAndWait({
    didCompleteRequest: () => true,
    domainScope,
    localId: "profile-local-id",
    onInvalidated: () => {
      generation += 1;
      invalidationCount += 1;
    },
    request: () => lane.requestSync(),
  });

  await runStarted;
  expect(await result).toBe(false);
  expect(invalidationCount).toBe(1);

  releaseRun();
  await waitForSyncLane(
    () =>
      getDomainSyncCoordinatorSnapshot(domainScope).lanes[0]?.runAbandoned ===
      false,
  );
  expect(persistedLateResponse).toBe(false);
});

test("coordinator disposal resolves a pending request as incomplete", async () => {
  const domainScope = createDomainScope();
  let invalidationCount = 0;
  const lane = registerDocumentSyncLane({
    domainScope,
    localId: "profile-local-id",
    run: () => new Promise(() => undefined),
  });
  const result = requestDocumentSyncLaneAndWait({
    didCompleteRequest: () => false,
    domainScope,
    localId: "profile-local-id",
    onInvalidated: () => {
      invalidationCount += 1;
    },
    request: () => lane.requestSync(),
  });

  disposeDomainSyncCoordinator(domainScope);
  expect(await result).toBe(false);
  expect(invalidationCount).toBe(1);
});

test("an already-aborted request invalidates without scheduling work", async () => {
  const domainScope = createDomainScope();
  const lane = registerDocumentSyncLane({
    domainScope,
    localId: "profile-local-id",
    run: async () => undefined,
  });
  const abortController = new AbortController();
  abortController.abort();
  let invalidated = false;
  let requested = false;

  expect(
    await requestDocumentSyncLaneAndWait({
      didCompleteRequest: () => true,
      domainScope,
      localId: "profile-local-id",
      onInvalidated: () => {
        invalidated = true;
      },
      request: () => {
        requested = true;
        lane.requestSync();
      },
      signal: abortController.signal,
    }),
  ).toBe(false);
  expect(invalidated).toBe(true);
  expect(requested).toBe(false);
});

test("a missing document lane reports the request as incomplete", async () => {
  const domainScope = createDomainScope();
  let requested = false;

  expect(
    await requestDocumentSyncLaneAndWait({
      didCompleteRequest: () => true,
      domainScope,
      localId: "missing-profile-local-id",
      request: () => {
        requested = true;
      },
    }),
  ).toBe(false);
  expect(requested).toBe(false);
});

test("didRegainSyncPrerequisites detects restored sync inputs", () => {
  const runtime: SyncRuntimeStatus = {
    auth: {
      isAuthenticated: false,
    },
    crypto: {
      encapsulationKeyPair: null,
    },
    state: {
      online: false,
    },
  };

  expect(didRegainSyncPrerequisites(runtime, runtime)).toBe(false);
  expect(
    didRegainSyncPrerequisites(runtime, {
      ...runtime,
      state: {
        online: true,
      },
    }),
  ).toBe(true);
  expect(
    didRegainSyncPrerequisites(runtime, {
      ...runtime,
      auth: {
        isAuthenticated: true,
      },
    }),
  ).toBe(true);
  expect(
    didRegainSyncPrerequisites(runtime, {
      ...runtime,
      crypto: {
        encapsulationKeyPair: {},
      },
    }),
  ).toBe(true);
});

test("isDatabaseUnavailableError follows wrapped database errors", () => {
  expect(isDatabaseUnavailableError(new Error("DB has been closed."))).toBe(
    true,
  );
  expect(
    isDatabaseUnavailableError(
      new Error("outer", {
        cause: new Error("Database worker client has been destroyed."),
      }),
    ),
  ).toBe(true);
  expect(isDatabaseUnavailableError(new Error("other"))).toBe(false);
});
