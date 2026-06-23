import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import {
  didRegainSyncPrerequisites,
  isDestroyedDatabaseClientError,
  type SyncRuntimeStatus,
} from "../../data/sync/syncCoordinator";
import { registerContainerContentsSyncLane } from "./syncLane";

function flushSyncLane() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("registerContainerContentsSyncLane registers the container contents lane for a domain scope", async () => {
  const domainScope = createDomainScope();
  const calls: string[] = [];
  const firstLane = registerContainerContentsSyncLane({
    domainScope,
    run: async () => {
      calls.push("first");
    },
  });
  registerContainerContentsSyncLane({
    domainScope,
    run: async () => {
      calls.push("second");
    },
  });

  firstLane.requestSync();
  await flushSyncLane();

  expect(calls).toEqual(["second"]);
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
