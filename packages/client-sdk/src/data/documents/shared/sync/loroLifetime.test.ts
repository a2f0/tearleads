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
  const window = await lifetimes.openWindow(false);
  expect(lifetimes.endedHidden("tab")).toBe(true);
  surfaces.setHidden(false);
  expect(surfaces.markers.has(key)).toBe(false);
  surfaces.setHidden(true);
  expect(lifetimes.closeWindow(window)).toBe(true);
  expect(surfaces.markers.has(key)).toBe(false);
  expect(lifetimes.closeWindow(window)).toBe(false);
});

// A failure anywhere in the lifetime, even outside document sync, may leave
// the module unusable, so a death after it says nothing about the update a
// window then held.
test("a failure marker covers the windows open after the lifetime failed", async () => {
  const surfaces = host();
  const lifetimes = createLoroLifetimes({ id: "tab", ...surfaces });

  lifetimes.noteFailed();
  expect(lifetimes.endedFailed("tab")).toBe(false);
  const window = await lifetimes.openWindow(false);
  expect(lifetimes.endedFailed("tab")).toBe(true);
  lifetimes.forget("tab");
  expect(lifetimes.endedFailed("tab")).toBe(false);
  lifetimes.closeWindow(window);
  expect(surfaces.markers.size).toBe(0);
});

// A row the lifetime could not delete outlives its window, so the failure
// marker stands with no window open; neither a later failure nor a claim
// that finds no row in one database drops it, as rows may stand in others.
test("an unsettled row keeps the failure marker through failures and claims", () => {
  const surfaces = host();
  const lifetimes = createLoroLifetimes({ id: "tab", ...surfaces });

  lifetimes.noteUnsettledWindow();
  lifetimes.noteFailed();
  lifetimes.forget("tab");

  expect(lifetimes.openWindowCount()).toBe(0);
  expect(lifetimes.endedFailed("tab")).toBe(true);
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

// An isolating window reads alone, so the death it may cause names it alone;
// other windows wait behind it and share the gate with each other.
test("an isolating window waits to be the lifetime's only one", async () => {
  const lifetimes = createLoroLifetimes({ id: "tab" });
  const order: string[] = [];
  const first = await lifetimes.openWindow(false);
  const isolating = lifetimes.openWindow(true).then((window) => {
    order.push("isolating");
    return window;
  });
  const later = lifetimes.openWindow(false).then(() => order.push("shared-b"));
  await Promise.resolve();
  expect(order).toEqual([]);

  lifetimes.closeWindow(first);
  const alone = await isolating;
  expect(lifetimes.openWindowCount()).toBe(1);
  lifetimes.closeWindow(alone);
  await later;

  expect(order).toEqual(["isolating", "shared-b"]);
});

// The gate is for progress only: a window that cannot get in opens anyway,
// beside the others, and so does not count.
test("a window that waits too long opens outside the gate", async () => {
  const lifetimes = createLoroLifetimes({ gateWaitMs: 5, id: "tab" });
  await lifetimes.openWindow(false);

  await lifetimes.openWindow(true);

  expect(lifetimes.openWindowCount()).toBe(2);
});

// Two passes may read one scope at once, as when a store's runtime moved
// mid-pass: each holds a window of its own, and closing one leaves the other
// open, so the lifetime's markers still cover the pass still reading.
test("each open is a window of its own, closed only by its id", async () => {
  const surfaces = host();
  const lifetimes = createLoroLifetimes({ id: "tab", ...surfaces });
  surfaces.setHidden(true);
  const stale = await lifetimes.openWindow(false);
  const current = await lifetimes.openWindow(false);

  expect(stale).not.toBe(current);
  expect(lifetimes.openWindowCount()).toBe(2);
  expect(lifetimes.closeWindow(stale)).toBe(true);
  expect(lifetimes.hasWindow(current)).toBe(true);
  expect(lifetimes.endedHidden("tab")).toBe(true);
  expect(lifetimes.closeWindow(current)).toBe(true);
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

// A restart drains the lifetime's windows: none is admitted, queued ones
// included, until the open ones close, and those asked for meanwhile enter
// in order once the drain ends.
test("a drain admits no window until the open ones close", async () => {
  const lifetimes = createLoroLifetimes({ id: "tab", restartHoldMs: 1 });
  const order: string[] = [];
  const open = await lifetimes.openWindow(false);
  const queued = lifetimes.openWindow(true).then((window) => {
    order.push("queued");
    return window;
  });

  const drained = lifetimes.drainWindows(60_000);
  const asked = lifetimes.openWindow(false).then((window) => {
    order.push("asked");
    return window;
  });
  await Promise.resolve();
  expect(lifetimes.openWindowCount()).toBe(1);

  lifetimes.closeWindow(open);
  expect(await drained).toBe(true);
  lifetimes.closeWindow(await queued);
  await asked;

  expect(order).toEqual(["queued", "asked"]);
});

// A drain never holds the restart past its wait, nor a window past the
// gate's: either goes ahead, reading outside the gate.
test("a drain ends after its wait, and a held window after the gate's", async () => {
  const lifetimes = createLoroLifetimes({
    gateWaitMs: 5,
    id: "tab",
    restartHoldMs: 1,
  });
  const open = await lifetimes.openWindow(false);
  const draining = lifetimes.drainWindows(60_000);

  const outside = await lifetimes.openWindow(false);
  expect(lifetimes.openWindowCount()).toBe(2);
  lifetimes.closeWindow(open);
  lifetimes.closeWindow(outside);
  expect(await draining).toBe(true);
  // The window that left the drain to read outside the gate holds no place
  // in it: once the hold ends, an isolating window enters at once.
  await new Promise((resolve) => setTimeout(resolve, 10));
  let alone = false;
  const isolating = lifetimes.openWindow(true).then((window) => {
    alone = true;
    return window;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(alone).toBe(true);
  lifetimes.closeWindow(await isolating);

  const short = createLoroLifetimes({ id: "short", restartHoldMs: 1 });
  const stuck = await short.openWindow(false);
  expect(await short.drainWindows(5)).toBe(false);
  expect(await short.openWindow(false)).not.toBe(stuck);
});

// A drained realm is about to restart, so nothing the drain held, and
// nothing asked for after it, opens a window before the restart: not even
// when no window was open to drain. A realm its host kept admits them once
// the restart's hold ends.
test("a drained realm opens no window before its restart", async () => {
  const lifetimes = createLoroLifetimes({ id: "tab", restartHoldMs: 20 });
  const open = await lifetimes.openWindow(false);
  const drained = lifetimes.drainWindows(60_000);
  const held = lifetimes.openWindow(false);
  lifetimes.closeWindow(open);
  expect(await drained).toBe(true);
  const asked = lifetimes.openWindow(false);
  await Promise.resolve();
  expect(lifetimes.openWindowCount()).toBe(0);
  lifetimes.closeWindow(await held);
  lifetimes.closeWindow(await asked);

  const idle = createLoroLifetimes({ id: "idle", restartHoldMs: 20 });
  expect(await idle.drainWindows(60_000)).toBe(true);
  const after = idle.openWindow(false);
  await Promise.resolve();
  expect(idle.openWindowCount()).toBe(0);
  idle.closeWindow(await after);
});

// A request held through the hold still enters outside the gate once its
// own wait ends, and a restart asked for while it is open drains it again.
test("a held window that leaves during the hold is drained again", async () => {
  const lifetimes = createLoroLifetimes({
    gateWaitMs: 5,
    id: "tab",
    restartHoldMs: 200,
  });
  expect(await lifetimes.drainWindows(60_000)).toBe(true);

  const outside = await lifetimes.openWindow(false);
  expect(lifetimes.openWindowCount()).toBe(1);
  let drained = false;
  const again = lifetimes.drainWindows(60_000).then((value) => {
    drained = true;
    return value;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(drained).toBe(false);

  lifetimes.closeWindow(outside);
  expect(await again).toBe(true);
});
