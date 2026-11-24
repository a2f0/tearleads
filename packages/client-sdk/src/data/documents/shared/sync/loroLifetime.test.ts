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
test("the hidden marker covers open windows only while the app is hidden", () => {
  const surfaces = host();
  const lifetimes = createLoroLifetimes({ id: "tab", ...surfaces });
  const key = "tearleads-loro-hidden:tab";

  surfaces.setHidden(true);
  expect(surfaces.markers.has(key)).toBe(false);
  lifetimes.openWindow("scope");
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
test("a failure marker covers the windows open after the lifetime failed", () => {
  const surfaces = host();
  const lifetimes = createLoroLifetimes({ id: "tab", ...surfaces });

  lifetimes.noteFailed();
  expect(lifetimes.endedFailed("tab")).toBe(false);
  lifetimes.openWindow("scope");
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
