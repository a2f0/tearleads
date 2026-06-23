import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import {
  didRegainSyncPrerequisites,
  isDestroyedDatabaseClientError,
  type SyncRuntimeStatus,
} from "../../data/sync/syncCoordinator";
import { registerDocumentSyncLane } from "./syncLane";

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

test("isDestroyedDatabaseClientError follows wrapped database errors", () => {
  expect(isDestroyedDatabaseClientError(new Error("DB has been closed."))).toBe(
    true,
  );
  expect(
    isDestroyedDatabaseClientError(
      new Error("outer", {
        cause: new Error("Database worker client has been destroyed."),
      }),
    ),
  ).toBe(true);
  expect(isDestroyedDatabaseClientError(new Error("other"))).toBe(false);
});
