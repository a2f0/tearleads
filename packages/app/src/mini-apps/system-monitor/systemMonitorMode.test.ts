import { afterEach, expect, test } from "bun:test";
import {
  DEFAULT_SYSTEM_MONITOR_MODE,
  loadSystemMonitorMode,
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "./systemMonitorMode";

const KEY = systemMonitorModeStorageKey("left");

afterEach(() => {
  globalThis.localStorage.clear();
});

test("defaults to windowed when nothing is stored", () => {
  expect(DEFAULT_SYSTEM_MONITOR_MODE).toBe("windowed");
  expect(loadSystemMonitorMode(KEY)).toBe("windowed");
});

test("round-trips a saved mode (load reads what save wrote)", () => {
  saveSystemMonitorMode(KEY, "pinned");
  expect(loadSystemMonitorMode(KEY)).toBe("pinned");

  saveSystemMonitorMode(KEY, "windowed");
  expect(loadSystemMonitorMode(KEY)).toBe("windowed");
});

test("falls back to the default for an unrecognized stored value", () => {
  globalThis.localStorage.setItem(KEY, "bogus");
  expect(loadSystemMonitorMode(KEY)).toBe("windowed");
});

test("keys are distinct per pane side", () => {
  expect(systemMonitorModeStorageKey("left")).not.toBe(
    systemMonitorModeStorageKey("right"),
  );
});
