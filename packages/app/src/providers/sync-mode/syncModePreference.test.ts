import { afterEach, expect, test } from "bun:test";
import {
  DEFAULT_SYNC_MODE,
  loadSyncMode,
  SYNC_MODE_STORAGE_KEY,
  saveSyncMode,
} from "./syncModePreference";

afterEach(() => {
  globalThis.localStorage.clear();
});

test("defaults to sync when nothing is stored", () => {
  expect(DEFAULT_SYNC_MODE).toBe("sync");
  expect(loadSyncMode()).toBe("sync");
});

test("round-trips a saved sync mode", () => {
  saveSyncMode("local-only");
  expect(loadSyncMode()).toBe("local-only");

  saveSyncMode("sync");
  expect(loadSyncMode()).toBe("sync");
});

test("falls back to the default for an unrecognized stored value", () => {
  globalThis.localStorage.setItem(SYNC_MODE_STORAGE_KEY, "bogus");
  expect(loadSyncMode()).toBe("sync");
});
