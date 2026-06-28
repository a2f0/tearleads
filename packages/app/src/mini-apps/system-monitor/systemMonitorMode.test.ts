import { afterEach, expect, test } from "bun:test";
import {
  DEFAULT_SYSTEM_MONITOR_DEVELOPER_MODE,
  DEFAULT_SYSTEM_MONITOR_MODE,
  loadSystemMonitorDeveloperMode,
  loadSystemMonitorMode,
  saveSystemMonitorDeveloperMode,
  saveSystemMonitorMode,
  systemMonitorDeveloperModeStorageKey,
  systemMonitorModeStorageKey,
} from "./systemMonitorMode";

const KEY = systemMonitorModeStorageKey("left");
const DEVELOPER_MODE_KEY = systemMonitorDeveloperModeStorageKey();

afterEach(() => {
  globalThis.localStorage.clear();
});

test("defaults to windowed when nothing is stored", () => {
  expect(DEFAULT_SYSTEM_MONITOR_MODE).toBe("windowed");
  expect(loadSystemMonitorMode(KEY)).toBe("windowed");
});

test("developer mode defaults to disabled when nothing is stored", () => {
  expect(DEFAULT_SYSTEM_MONITOR_DEVELOPER_MODE).toBe("disabled");
  expect(loadSystemMonitorDeveloperMode(DEVELOPER_MODE_KEY)).toBe("disabled");
});

test("round-trips a saved mode (load reads what save wrote)", () => {
  saveSystemMonitorMode(KEY, "pinned");
  expect(loadSystemMonitorMode(KEY)).toBe("pinned");

  saveSystemMonitorMode(KEY, "windowed");
  expect(loadSystemMonitorMode(KEY)).toBe("windowed");
});

test("round-trips a saved developer mode", () => {
  saveSystemMonitorDeveloperMode(DEVELOPER_MODE_KEY, "enabled");
  expect(loadSystemMonitorDeveloperMode(DEVELOPER_MODE_KEY)).toBe("enabled");

  saveSystemMonitorDeveloperMode(DEVELOPER_MODE_KEY, "disabled");
  expect(loadSystemMonitorDeveloperMode(DEVELOPER_MODE_KEY)).toBe("disabled");
});

test("falls back to the default for an unrecognized stored value", () => {
  globalThis.localStorage.setItem(KEY, "bogus");
  expect(loadSystemMonitorMode(KEY)).toBe("windowed");
});

test("developer mode falls back to the default for an unrecognized stored value", () => {
  globalThis.localStorage.setItem(DEVELOPER_MODE_KEY, "bogus");
  expect(loadSystemMonitorDeveloperMode(DEVELOPER_MODE_KEY)).toBe("disabled");
});

test("keys are distinct per pane side", () => {
  expect(systemMonitorModeStorageKey("left")).not.toBe(
    systemMonitorModeStorageKey("right"),
  );
});
