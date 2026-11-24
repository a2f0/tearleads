import { expect, test } from "bun:test";
import { createLoroLifetimes } from "./loroLifetime";
import { createRealmLoroRuntimeFailures } from "./loroRuntimeFailureLedger";
import { createLoroRuntimeHealth } from "./loroRuntimeHealth";

// A failure anywhere in the realm asks the host for a restart, once, and a
// listener hears each change until it unsubscribes.
test("a runtime failure asks the host for a restart", async () => {
  const health = createLoroRuntimeHealth({
    lifetimes: createLoroLifetimes({ id: "tab", restartHoldMs: 1 }),
  });
  let changes = 0;
  const unsubscribe = health.subscribe(() => {
    changes += 1;
  });

  health.noteRuntimeFailed();
  health.noteRuntimeFailed();
  expect(health.current()).toEqual({ status: "restartRequired" });
  expect(changes).toBe(1);
  unsubscribe();
  await health.prepareRestart();

  expect(health.current()).toEqual({ status: "ready" });
  expect(changes).toBe(1);
});

// The restart waits for every open window of the realm, so a reload
// leaves none behind, and a second request joins the first.
test("a restart is ready once the open windows close", async () => {
  const lifetimes = createLoroLifetimes({ id: "tab", restartHoldMs: 1 });
  const health = createLoroRuntimeHealth({ lifetimes });
  const first = await lifetimes.openWindow(false);
  const second = await lifetimes.openWindow(false);
  health.noteRuntimeFailed();
  let prepared = false;

  const preparing = health.prepareRestart().then(() => {
    prepared = true;
  });
  expect(health.prepareRestart()).toBe(health.prepareRestart());
  lifetimes.closeWindow(first);
  await Promise.resolve();
  await Promise.resolve();
  expect(health.current().status).toBe("draining");
  expect(prepared).toBe(false);

  lifetimes.closeWindow(second);
  await preparing;

  expect(health.current()).toEqual({ status: "ready" });
});

// A window that never closes must not keep the user's reload waiting.
test("a restart is ready after a bounded wait", async () => {
  const lifetimes = createLoroLifetimes({ id: "tab", restartHoldMs: 1 });
  const health = createLoroRuntimeHealth({ drainWaitMs: 5, lifetimes });
  await lifetimes.openWindow(false);
  health.noteRuntimeFailed();

  await health.prepareRestart();

  expect(health.current()).toEqual({ status: "ready" });
  expect(lifetimes.openWindowCount()).toBe(1);
});

// A listener that asks again while hearing the drain start joins it rather
// than starting a second drain.
test("a request from a listener joins the drain it hears", async () => {
  let drains = 0;
  const health = createLoroRuntimeHealth({
    lifetimes: {
      drainWindows: () => {
        drains += 1;
        return Promise.resolve(true);
      },
      subscribeWindowsReopened: () => () => {},
    },
  });
  health.noteRuntimeFailed();
  const joined: Promise<void>[] = [];
  health.subscribe(() => {
    if (health.current().status === "draining") {
      joined.push(health.prepareRestart());
    }
  });

  const first = health.prepareRestart();

  expect(joined).toEqual([first]);
  await first;
  expect(drains).toBe(1);
});

// A healthy realm has nothing to restart for: preparing drains nothing.
test("a healthy realm prepares at once", async () => {
  let drains = 0;
  const health = createLoroRuntimeHealth({
    lifetimes: {
      drainWindows: () => {
        drains += 1;
        return Promise.resolve(true);
      },
      subscribeWindowsReopened: () => () => {},
    },
  });

  await health.prepareRestart();

  expect(health.current()).toEqual({ status: "healthy" });
  expect(drains).toBe(0);
});

// `ready` lasts only while the hold admits no window: a realm its host kept
// running past the hold needs its restart again, and its listeners hear it.
test("a kept realm asks for its restart again once the hold ends", async () => {
  const lifetimes = createLoroLifetimes({ id: "tab", restartHoldMs: 5 });
  const health = createLoroRuntimeHealth({ lifetimes });
  health.noteRuntimeFailed();
  const heard: string[] = [];
  health.subscribe(() => heard.push(health.current().status));

  await health.prepareRestart();
  expect(health.current()).toEqual({ status: "ready" });
  await new Promise((resolve) => setTimeout(resolve, 30));

  expect(health.current()).toEqual({ status: "restartRequired" });
  expect(heard).toEqual(["draining", "ready", "restartRequired"]);
});

// A host listener that throws neither stops a failure being noted nor makes
// the restart reject.
test("a throwing listener breaks neither a failure nor a restart", async () => {
  const health = createLoroRuntimeHealth({
    lifetimes: createLoroLifetimes({ id: "tab", restartHoldMs: 1 }),
  });
  let heard = 0;
  health.subscribe(() => {
    throw new Error("host listener");
  });
  health.subscribe(() => {
    heard += 1;
  });

  expect(() => health.noteRuntimeFailed()).not.toThrow();
  await health.prepareRestart();

  expect(health.current()).toEqual({ status: "ready" });
  expect(heard).toBe(3);
});

// The realm's ledger is what tells the host: its first failure, wherever it
// happened, stops the realm's windows counting and asks for a restart.
test("a realm's first runtime failure asks for a restart once", () => {
  const calls: string[] = [];
  const ledger = createRealmLoroRuntimeFailures({
    health: { noteRuntimeFailed: () => calls.push("health") },
    lifetimes: { noteFailed: () => calls.push("lifetimes") },
  });

  ledger.noteFailure("update");
  ledger.unrecorded().noteFailure("other");

  expect(calls).toEqual(["lifetimes", "health"]);
});
