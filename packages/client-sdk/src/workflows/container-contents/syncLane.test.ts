import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import { DatabaseUnavailableError } from "../../data/sync/databaseUnavailable";
import {
  didRegainSyncPrerequisites,
  getDomainSyncCoordinatorSnapshot,
  isDatabaseUnavailableError,
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

test("a lane that loses its database completes instead of reporting", async () => {
  // The runtime is swapped under in-flight lane work on every identity switch,
  // logout, and Explorer retry, so this is a routine outcome — not a failure to
  // log and back off from.
  const domainScope = createDomainScope();
  const errors: unknown[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };

  try {
    const lane = registerContainerContentsSyncLane({
      domainScope,
      run: async () => {
        throw new DatabaseUnavailableError(
          "Trusted user identity resolution requires a ready SQLite trust store",
        );
      },
    });

    lane.requestSync();
    await flushSyncLane();

    expect(errors).toEqual([]);
    expect(
      getDomainSyncCoordinatorSnapshot(domainScope).lanes.find(
        (entry) => entry.key === "container-contents",
      )?.errorCount,
    ).toBe(0);
  } finally {
    console.error = originalConsoleError;
  }
});
