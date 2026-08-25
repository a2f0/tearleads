import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import {
  didRegainSyncPrerequisites,
  getDomainSyncCoordinatorSnapshot,
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
      domainScope,
      localId: "profile-local-id",
      request,
    }),
  ).toBe(false);
  shouldFail = false;
  expect(
    await requestDocumentSyncLaneAndWait({
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
  let finishRun = () => undefined;
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
    domainScope,
    localId: "profile-local-id",
    request: () => lane.requestSync(),
    signal: abortController.signal,
  });

  abortController.abort();
  expect(await result).toBe(false);
  finishRun();
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
