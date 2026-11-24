import { expect, test } from "bun:test";
import { createLoroLifetimes } from "./loroLifetime";
import { createLoroRuntimeHealth } from "./loroRuntimeHealth";

// A failure anywhere in the realm asks the host for a restart, once.
test("a runtime failure asks the host for a restart", () => {
  const health = createLoroRuntimeHealth({
    lifetimes: createLoroLifetimes({ id: "tab" }),
  });
  let changes = 0;
  const unsubscribe = health.subscribe(() => {
    changes += 1;
  });

  health.noteRuntimeFailed();
  health.noteRuntimeFailed();
  unsubscribe();
  health.noteRuntimeFailed();

  expect(health.current()).toEqual({ status: "restartRequired" });
  expect(changes).toBe(1);
});

// The restart waits for the realm's open windows, so a reload leaves none
// behind, and a second request joins the first.
test("a restart is ready once the open windows close", async () => {
  const lifetimes = createLoroLifetimes({ id: "tab" });
  const health = createLoroRuntimeHealth({ lifetimes });
  const window = await lifetimes.openWindow(false);
  health.noteRuntimeFailed();
  let prepared = false;

  const preparing = health.prepareRestart().then(() => {
    prepared = true;
  });
  expect(health.prepareRestart()).toBe(health.prepareRestart());
  await Promise.resolve();
  expect(health.current().status).toBe("draining");
  expect(prepared).toBe(false);

  lifetimes.closeWindow(window);
  await preparing;

  expect(health.current()).toEqual({ status: "ready" });
});

// A window that never closes must not keep the user's reload waiting.
test("a restart is ready after a bounded wait", async () => {
  const lifetimes = createLoroLifetimes({ id: "tab" });
  const health = createLoroRuntimeHealth({ drainWaitMs: 5, lifetimes });
  await lifetimes.openWindow(false);

  await health.prepareRestart();

  expect(health.current()).toEqual({ status: "ready" });
  expect(lifetimes.openWindowCount()).toBe(1);
});
