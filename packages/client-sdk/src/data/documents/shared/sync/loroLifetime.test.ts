import { expect, test } from "bun:test";
import { createLoroLifetimes } from "./loroLifetime";

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
  lifetimes.windowOpened();
  expect(lifetimes.endedHidden("tab")).toBe(true);
  surfaces.setHidden(false);
  expect(surfaces.markers.has(key)).toBe(false);
  surfaces.setHidden(true);
  lifetimes.windowClosed();
  expect(surfaces.markers.has(key)).toBe(false);
});

// Without Web Locks nothing tells a dead lifetime from a live one, so every
// other lifetime counts as alive and no window is ever claimed.
test("a host without Web Locks treats every other lifetime as alive", async () => {
  const lifetimes = createLoroLifetimes({ id: "cli" });
  await lifetimes.ready();
  expect(await lifetimes.endedAmong(["gone", "other"])).toEqual(new Set());
});
