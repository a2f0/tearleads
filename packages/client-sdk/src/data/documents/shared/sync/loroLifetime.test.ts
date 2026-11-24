import { expect, test } from "bun:test";
import {
  createLoroLifetimes,
  type LifetimeLockManager,
  pageVisibility,
} from "./loroLifetime";

function host() {
  const markers = new Map<string, string>();
  const listeners: (() => void)[] = [];
  let hidden = false;
  return {
    markers,
    setHidden(value: boolean) {
      hidden = value;
      for (const listener of listeners) listener();
    },
    storage: {
      getItem: (key: string) => markers.get(key) ?? null,
      removeItem: (key: string) => {
        markers.delete(key);
      },
      setItem: (key: string, value: string) => {
        markers.set(key, value);
      },
    },
    visibility: {
      hidden: () => hidden,
      onChange: (listener: () => void) => {
        listeners.push(listener);
      },
    },
  };
}

// A marker stands only while a window is open and the app is hidden, so a
// closed tab with no window open leaves nothing behind in storage.
test("the hidden marker covers open windows only while the app is hidden", async () => {
  const surfaces = host();
  const lifetimes = createLoroLifetimes({ id: "tab", ...surfaces });
  const key = "tearleads-loro-hidden:tab";

  surfaces.setHidden(true);
  expect(surfaces.markers.has(key)).toBe(false);
  await lifetimes.openWindow("scope", false);
  expect(lifetimes.endedHidden("tab")).toBe(true);
  surfaces.setHidden(false);
  expect(surfaces.markers.has(key)).toBe(false);
  surfaces.setHidden(true);
  expect(lifetimes.closeWindow("scope")).toBe(true);
  expect(surfaces.markers.has(key)).toBe(false);
  expect(lifetimes.closeWindow("scope")).toBe(false);
});

// A failure anywhere in the lifetime, even outside document sync, may leave
// the module unusable, so a death after it says nothing about the update a
// window then held.
test("a failure marker covers the windows open after the lifetime failed", async () => {
  const surfaces = host();
  const lifetimes = createLoroLifetimes({ id: "tab", ...surfaces });

  lifetimes.noteFailed();
  expect(lifetimes.endedFailed("tab")).toBe(false);
  await lifetimes.openWindow("scope", false);
  expect(lifetimes.endedFailed("tab")).toBe(true);
  lifetimes.forget("tab");
  expect(lifetimes.endedFailed("tab")).toBe(false);
  lifetimes.closeWindow("scope");
  expect(surfaces.markers.size).toBe(0);
});

// Without Web Locks nothing tells a dead lifetime from a live one, so every
// other lifetime counts as alive, and this one opens no window to claim.
test("a host without Web Locks opens no window and claims none", async () => {
  const lifetimes = createLoroLifetimes({ id: "cli" });
  expect(await lifetimes.ready()).toBe(false);
  expect(await lifetimes.endedAmong(["gone", "other"])).toEqual(new Set());
});

// A refused lock must not stop sync: the lifetime just opens no window.
test("a refused lock leaves the lifetime without windows", async () => {
  const refusing: LifetimeLockManager = {
    query: async () => ({ held: [] }),
    request: async () => {
      throw new Error("SecurityError");
    },
  };
  const lifetimes = createLoroLifetimes({ id: "opaque", locks: refusing });
  expect(await lifetimes.ready()).toBe(false);
});

test("a page that hides, closes, or comes back reports it", () => {
  const listeners = new Map<string, () => void>();
  const document = {
    addEventListener: (type: string, listener: () => void) => {
      listeners.set(type, listener);
    },
    visibilityState: "visible",
  };
  const visibility = pageVisibility({
    addEventListener: (type, listener) => listeners.set(type, listener),
    document,
  });
  const changes: boolean[] = [];
  visibility.onChange(() => changes.push(visibility.hidden()));

  listeners.get("pagehide")?.();
  listeners.get("pageshow")?.();
  document.visibilityState = "hidden";
  listeners.get("visibilitychange")?.();

  expect(changes).toEqual([true, false, true]);
});

// An isolating scope reads alone, so the death it may cause names it alone;
// other scopes wait behind it and share the gate with each other.
test("an isolating scope's window waits to be the lifetime's only one", async () => {
  const lifetimes = createLoroLifetimes({ id: "tab" });
  const order: string[] = [];
  await lifetimes.openWindow("shared-a", false);
  const isolating = lifetimes
    .openWindow("isolating", true)
    .then(() => order.push("isolating"));
  const later = lifetimes
    .openWindow("shared-b", false)
    .then(() => order.push("shared-b"));
  await Promise.resolve();
  expect(order).toEqual([]);

  lifetimes.closeWindow("shared-a");
  await isolating;
  expect(lifetimes.openWindowCount()).toBe(1);
  lifetimes.closeWindow("isolating");
  await later;

  expect(order).toEqual(["isolating", "shared-b"]);
});

// The gate is for progress only: a window that cannot get in opens anyway,
// beside the others, and so does not count.
test("a window that waits too long opens outside the gate", async () => {
  const lifetimes = createLoroLifetimes({ gateWaitMs: 5, id: "tab" });
  await lifetimes.openWindow("stuck", false);

  await lifetimes.openWindow("isolating", true);

  expect(lifetimes.openWindowCount()).toBe(2);
});

// Only an open window closes: a scope still waiting keeps its place, and
// enters once the gate frees, with nothing left open behind it.
test("closing a scope that is still waiting for the gate keeps its place", async () => {
  const lifetimes = createLoroLifetimes({ gateWaitMs: 60_000, id: "tab" });
  await lifetimes.openWindow("shared", false);
  const isolating = lifetimes.openWindow("isolating", true);

  expect(lifetimes.closeWindow("isolating")).toBe(false);
  lifetimes.closeWindow("shared");
  await isolating;

  expect(lifetimes.hasWindow("isolating")).toBe(true);
  expect(lifetimes.closeWindow("isolating")).toBe(true);
  expect(lifetimes.openWindowCount()).toBe(0);
});

// A lock request a host never grants nor refuses must not hold every page's
// sync: after a bounded wait the lifetime opens no windows.
test("a lock request that never settles leaves the lifetime unready", async () => {
  const lifetimes = createLoroLifetimes({
    id: "frozen",
    locks: {
      query: async () => ({ held: [] }),
      request: () => new Promise<void>(() => undefined),
    },
    lockWaitMs: 5,
  });

  expect(await lifetimes.ready()).toBe(false);
});
