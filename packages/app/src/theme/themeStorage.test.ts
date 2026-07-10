import { afterEach, expect, test } from "bun:test";
import { loadTheme, saveTheme } from "./themeStorage";
import { DEFAULT_THEME_ID } from "./themes";

const STORAGE_KEY = "tearleads.theme";

afterEach(() => {
  globalThis.localStorage.removeItem(STORAGE_KEY);
});

test("loadTheme returns the default when nothing is stored", () => {
  expect(loadTheme()).toBe(DEFAULT_THEME_ID);
});

test("saveTheme then loadTheme round-trips a valid theme", () => {
  saveTheme("dark");
  expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe("dark");
  expect(loadTheme()).toBe("dark");
});

test("loadTheme falls back to the default for an unrecognized stored value", () => {
  globalThis.localStorage.setItem(STORAGE_KEY, "solarized");
  expect(loadTheme()).toBe(DEFAULT_THEME_ID);
});
