import { expect, test } from "bun:test";
import { reloadAfterRestore } from "./restoreReload";

test("the acknowledgements are kept before the caches clear and the app reloads", async () => {
  const steps: string[] = [];
  await reloadAfterRestore({
    clearCaches: () => steps.push("clear"),
    logError: () => steps.push("error"),
    prepare: async () => {
      steps.push("prepare");
    },
    reload: () => steps.push("reload"),
  });

  expect(steps).toEqual(["prepare", "clear", "reload"]);
});

test("a failed preparation is logged and the app still reloads", async () => {
  const steps: string[] = [];
  await reloadAfterRestore({
    clearCaches: () => steps.push("clear"),
    logError: (message) => steps.push(`error: ${message}`),
    prepare: () => Promise.reject(new Error("storage unavailable")),
    reload: () => steps.push("reload"),
  });

  expect(steps).toEqual([
    "error: Failed to keep the session's root acknowledgements across restore",
    "clear",
    "reload",
  ]);
});
