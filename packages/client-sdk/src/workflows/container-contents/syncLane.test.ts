import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import {
  didRegainContainerContentsSyncPrerequisites,
  isDestroyedContainerContentsSyncRuntimeError,
  registerContainerContentsSyncLane,
} from "./syncLane";

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

test("didRegainContainerContentsSyncPrerequisites detects restored sync inputs", () => {
  const runtime = {
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

  expect(didRegainContainerContentsSyncPrerequisites(runtime, runtime)).toBe(
    false,
  );
  expect(
    didRegainContainerContentsSyncPrerequisites(runtime, {
      ...runtime,
      state: {
        online: true,
      },
    }),
  ).toBe(true);
  expect(
    didRegainContainerContentsSyncPrerequisites(runtime, {
      ...runtime,
      auth: {
        isAuthenticated: true,
      },
    }),
  ).toBe(true);
  expect(
    didRegainContainerContentsSyncPrerequisites(runtime, {
      ...runtime,
      crypto: {
        encapsulationKeyPair: {},
      },
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
