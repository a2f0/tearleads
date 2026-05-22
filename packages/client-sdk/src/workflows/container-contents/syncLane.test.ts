import { expect, test } from "bun:test";
import {
  didRegainContainerContentsSyncPrerequisites,
  isDestroyedContainerContentsSyncRuntimeError,
  registerContainerContentsSyncLane,
} from "./syncLane";

function flushSyncLane() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("registerContainerContentsSyncLane registers the container contents lane for a domain scope", async () => {
  const domainScope = {};
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

test("didRegainContainerContentsSyncPrerequisites detects restored sync inputs", () => {
  const runtime = {
    encapsulationKeyPair: null,
    isAuthenticated: false,
    online: false,
  };

  expect(didRegainContainerContentsSyncPrerequisites(runtime, runtime)).toBe(
    false,
  );
  expect(
    didRegainContainerContentsSyncPrerequisites(runtime, {
      ...runtime,
      online: true,
    }),
  ).toBe(true);
  expect(
    didRegainContainerContentsSyncPrerequisites(runtime, {
      ...runtime,
      isAuthenticated: true,
    }),
  ).toBe(true);
  expect(
    didRegainContainerContentsSyncPrerequisites(runtime, {
      ...runtime,
      encapsulationKeyPair: {},
    }),
  ).toBe(true);
});

test("isDestroyedContainerContentsSyncRuntimeError follows wrapped database errors", () => {
  expect(
    isDestroyedContainerContentsSyncRuntimeError(
      new Error("DB has been closed."),
    ),
  ).toBe(true);
  expect(
    isDestroyedContainerContentsSyncRuntimeError(
      new Error("outer", {
        cause: new Error("Database worker client has been destroyed."),
      }),
    ),
  ).toBe(true);
  expect(isDestroyedContainerContentsSyncRuntimeError(new Error("other"))).toBe(
    false,
  );
});
