import { expect, test } from "bun:test";
import {
  didRegainContactSyncPrerequisites,
  isDestroyedContactSyncRuntimeError,
  registerContactSyncLane,
} from "@tearleads/client-sdk/workflows/contacts/syncLane";

function flushSyncLane() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("registerContactSyncLane registers the contacts lane for a domain scope", async () => {
  const domainScope = {};
  const calls: string[] = [];
  const firstLane = registerContactSyncLane({
    domainScope,
    run: async () => {
      calls.push("first");
    },
  });
  registerContactSyncLane({
    domainScope,
    run: async () => {
      calls.push("second");
    },
  });

  firstLane.requestSync();
  await flushSyncLane();

  expect(calls).toEqual(["second"]);
});

test("didRegainContactSyncPrerequisites detects restored sync inputs", () => {
  const runtime = {
    encapsulationKeyPair: null,
    isAuthenticated: false,
    online: false,
  };

  expect(didRegainContactSyncPrerequisites(runtime, runtime)).toBe(false);
  expect(
    didRegainContactSyncPrerequisites(runtime, {
      ...runtime,
      online: true,
    }),
  ).toBe(true);
  expect(
    didRegainContactSyncPrerequisites(runtime, {
      ...runtime,
      isAuthenticated: true,
    }),
  ).toBe(true);
  expect(
    didRegainContactSyncPrerequisites(runtime, {
      ...runtime,
      encapsulationKeyPair: {},
    }),
  ).toBe(true);
});

test("isDestroyedContactSyncRuntimeError follows wrapped database errors", () => {
  expect(
    isDestroyedContactSyncRuntimeError(new Error("DB has been closed.")),
  ).toBe(true);
  expect(
    isDestroyedContactSyncRuntimeError(
      new Error("outer", {
        cause: new Error("Database worker client has been destroyed."),
      }),
    ),
  ).toBe(true);
  expect(isDestroyedContactSyncRuntimeError(new Error("other"))).toBe(false);
});
