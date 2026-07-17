import { afterEach, expect, test } from "bun:test";
import { loadStoredTheme, saveTheme } from "./themeStorage";

const CHOICE_KEY = "tearleads.theme.choice";
const LEGACY_KEY = "tearleads.theme";

afterEach(() => {
  globalThis.localStorage.removeItem(CHOICE_KEY);
  globalThis.localStorage.removeItem(LEGACY_KEY);
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

test("a legacy auto-persisted light default is not treated as an explicit choice", () => {
  // The old provider persisted "light" on mount for users who never chose, so
  // this must not block the OS-following default.
  globalThis.localStorage.setItem(LEGACY_KEY, "light");

  expect(loadStoredTheme()).toBeNull();
  // The legacy key is cleared so the migration runs only once.
  expect(globalThis.localStorage.getItem(LEGACY_KEY)).toBeNull();
});

test("a legacy non-default theme is migrated as an explicit choice", () => {
  // Only an explicit toggle could have stored a non-default theme under the old
  // provider, so it is preserved as a choice.
  globalThis.localStorage.setItem(LEGACY_KEY, "dark");

  expect(loadStoredTheme()).toBe("dark");
  expect(globalThis.localStorage.getItem(LEGACY_KEY)).toBeNull();
  expect(globalThis.localStorage.getItem(CHOICE_KEY)).toBe("dark");
});

test("a new choice takes precedence over a stale legacy value", () => {
  globalThis.localStorage.setItem(CHOICE_KEY, "light");
  globalThis.localStorage.setItem(LEGACY_KEY, "dark");

  expect(loadStoredTheme()).toBe("light");
});

test("migrating an unrecognized legacy value clears it and stores no choice", () => {
  globalThis.localStorage.setItem(LEGACY_KEY, "solarized");

  expect(loadStoredTheme()).toBeNull();
  expect(globalThis.localStorage.getItem(LEGACY_KEY)).toBeNull();
  expect(globalThis.localStorage.getItem(CHOICE_KEY)).toBeNull();
});
