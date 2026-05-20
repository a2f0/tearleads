import { expect, test } from "bun:test";
import {
  didRegainDocumentSyncPrerequisites,
  isDestroyedDocumentSyncRuntimeError,
  registerDocumentSyncLane,
} from "./syncLane";

function flushSyncLane() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("registerDocumentSyncLane registers a document lane by local id", async () => {
  const domainScope = {};
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

test("didRegainDocumentSyncPrerequisites detects restored sync inputs", () => {
  const runtime = {
    encapsulationKeyPair: null,
    isAuthenticated: false,
    online: false,
  };

  expect(didRegainDocumentSyncPrerequisites(runtime, runtime)).toBe(false);
  expect(
    didRegainDocumentSyncPrerequisites(runtime, {
      ...runtime,
      online: true,
    }),
  ).toBe(true);
  expect(
    didRegainDocumentSyncPrerequisites(runtime, {
      ...runtime,
      isAuthenticated: true,
    }),
  ).toBe(true);
  expect(
    didRegainDocumentSyncPrerequisites(runtime, {
      ...runtime,
      encapsulationKeyPair: {},
    }),
  ).toBe(true);
});

test("isDestroyedDocumentSyncRuntimeError follows wrapped database errors", () => {
  expect(
    isDestroyedDocumentSyncRuntimeError(new Error("DB has been closed.")),
  ).toBe(true);
  expect(
    isDestroyedDocumentSyncRuntimeError(
      new Error("outer", {
        cause: new Error("Database worker client has been destroyed."),
      }),
    ),
  ).toBe(true);
  expect(isDestroyedDocumentSyncRuntimeError(new Error("other"))).toBe(false);
});
