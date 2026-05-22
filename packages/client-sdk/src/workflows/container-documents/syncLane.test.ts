import { expect, test } from "bun:test";
import {
  didRegainContainerDocumentsSyncPrerequisites,
  isDestroyedContainerDocumentsSyncRuntimeError,
  registerContainerDocumentsSyncLane,
} from "./syncLane";

function flushSyncLane() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("registerContainerDocumentsSyncLane registers the containerDocuments lane for a domain scope", async () => {
  const domainScope = {};
  const calls: string[] = [];
  const firstLane = registerContainerDocumentsSyncLane({
    domainScope,
    run: async () => {
      calls.push("first");
    },
  });
  registerContainerDocumentsSyncLane({
    domainScope,
    run: async () => {
      calls.push("second");
    },
  });

  firstLane.requestSync();
  await flushSyncLane();

  expect(calls).toEqual(["second"]);
});

test("didRegainContainerDocumentsSyncPrerequisites detects restored sync inputs", () => {
  const runtime = {
    encapsulationKeyPair: null,
    isAuthenticated: false,
    online: false,
  };

  expect(didRegainContainerDocumentsSyncPrerequisites(runtime, runtime)).toBe(
    false,
  );
  expect(
    didRegainContainerDocumentsSyncPrerequisites(runtime, {
      ...runtime,
      online: true,
    }),
  ).toBe(true);
  expect(
    didRegainContainerDocumentsSyncPrerequisites(runtime, {
      ...runtime,
      isAuthenticated: true,
    }),
  ).toBe(true);
  expect(
    didRegainContainerDocumentsSyncPrerequisites(runtime, {
      ...runtime,
      encapsulationKeyPair: {},
    }),
  ).toBe(true);
});

test("isDestroyedContainerDocumentsSyncRuntimeError follows wrapped database errors", () => {
  expect(
    isDestroyedContainerDocumentsSyncRuntimeError(
      new Error("DB has been closed."),
    ),
  ).toBe(true);
  expect(
    isDestroyedContainerDocumentsSyncRuntimeError(
      new Error("outer", {
        cause: new Error("Database worker client has been destroyed."),
      }),
    ),
  ).toBe(true);
  expect(
    isDestroyedContainerDocumentsSyncRuntimeError(new Error("other")),
  ).toBe(false);
});
