import { expect, test } from "bun:test";
import {
  didRegainExplorerSyncPrerequisites,
  isDestroyedExplorerSyncRuntimeError,
  registerExplorerSyncLane,
} from "./syncLane";

function flushSyncLane() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("registerExplorerSyncLane registers the explorer lane for a domain scope", async () => {
  const domainScope = {};
  const calls: string[] = [];
  const firstLane = registerExplorerSyncLane({
    domainScope,
    run: async () => {
      calls.push("first");
    },
  });
  registerExplorerSyncLane({
    domainScope,
    run: async () => {
      calls.push("second");
    },
  });

  firstLane.requestSync();
  await flushSyncLane();

  expect(calls).toEqual(["second"]);
});

test("didRegainExplorerSyncPrerequisites detects restored sync inputs", () => {
  const runtime = {
    encapsulationKeyPair: null,
    isAuthenticated: false,
    online: false,
  };

  expect(didRegainExplorerSyncPrerequisites(runtime, runtime)).toBe(false);
  expect(
    didRegainExplorerSyncPrerequisites(runtime, {
      ...runtime,
      online: true,
    }),
  ).toBe(true);
  expect(
    didRegainExplorerSyncPrerequisites(runtime, {
      ...runtime,
      isAuthenticated: true,
    }),
  ).toBe(true);
  expect(
    didRegainExplorerSyncPrerequisites(runtime, {
      ...runtime,
      encapsulationKeyPair: {},
    }),
  ).toBe(true);
});

test("isDestroyedExplorerSyncRuntimeError follows wrapped database errors", () => {
  expect(
    isDestroyedExplorerSyncRuntimeError(new Error("DB has been closed.")),
  ).toBe(true);
  expect(
    isDestroyedExplorerSyncRuntimeError(
      new Error("outer", {
        cause: new Error("Database worker client has been destroyed."),
      }),
    ),
  ).toBe(true);
  expect(isDestroyedExplorerSyncRuntimeError(new Error("other"))).toBe(false);
});
