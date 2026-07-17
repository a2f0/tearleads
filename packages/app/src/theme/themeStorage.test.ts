import { afterEach, expect, test } from "bun:test";
import { loadStoredTheme, saveTheme } from "./themeStorage";

const STORAGE_KEY = "tearleads.theme";

afterEach(() => {
  globalThis.localStorage.removeItem(STORAGE_KEY);
});

test("loadStoredTheme returns null when nothing is stored", () => {
  expect(loadStoredTheme()).toBeNull();
});

test("saveTheme then loadStoredTheme round-trips a valid theme", () => {
  saveTheme("dark");
  expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe("dark");
  expect(loadStoredTheme()).toBe("dark");
});

test("loadStoredTheme treats an unrecognized stored value as no choice", () => {
  globalThis.localStorage.setItem(STORAGE_KEY, "solarized");
  expect(loadStoredTheme()).toBeNull();
});
