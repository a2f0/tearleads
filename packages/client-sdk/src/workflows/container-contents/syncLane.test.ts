import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/shared/domainScope";
import { DatabaseUnavailableError } from "../../data/sync/databaseUnavailable";
import { getDomainSyncCoordinatorSnapshot } from "../../data/sync/syncCoordinator";
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
