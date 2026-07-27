import { afterEach, expect, test } from "bun:test";
import { loadStoredTheme, saveTheme } from "./themeStorage";

const CHOICE_KEY = "tearleads.theme.choice";

afterEach(() => {
  globalThis.localStorage.removeItem(CHOICE_KEY);
});

test("loadStoredTheme returns null when nothing is stored", () => {
  expect(loadStoredTheme()).toBeNull();
});

test("saveTheme writes the choice key and loadStoredTheme round-trips it", () => {
  saveTheme("dark");
  expect(globalThis.localStorage.getItem(CHOICE_KEY)).toBe("dark");
  expect(loadStoredTheme()).toBe("dark");
});

test("loadStoredTheme treats an unrecognized stored choice as no choice", () => {
  globalThis.localStorage.setItem(CHOICE_KEY, "solarized");
  expect(loadStoredTheme()).toBeNull();
});
