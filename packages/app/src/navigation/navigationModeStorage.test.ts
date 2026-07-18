import { afterEach, expect, test } from "bun:test";
import {
  loadStoredNavigationMode,
  saveNavigationMode,
} from "./navigationModeStorage";

const CHOICE_KEY = "tearleads.navigationMode.choice";

afterEach(() => {
  globalThis.localStorage.removeItem(CHOICE_KEY);
});

test("returns null when nothing is stored, so the layout defers to auto detection", () => {
  expect(loadStoredNavigationMode()).toBeNull();
});

test("round-trips an explicit windowed/routed choice", () => {
  saveNavigationMode("routed");
  expect(loadStoredNavigationMode()).toBe("routed");

  saveNavigationMode("windowed");
  expect(loadStoredNavigationMode()).toBe("windowed");
});

test("saving null clears the stored choice back to auto", () => {
  saveNavigationMode("routed");
  saveNavigationMode(null);

  expect(globalThis.localStorage.getItem(CHOICE_KEY)).toBeNull();
  expect(loadStoredNavigationMode()).toBeNull();
});

test("an unrecognized stored value is treated as no choice", () => {
  globalThis.localStorage.setItem(CHOICE_KEY, "sideways");
  expect(loadStoredNavigationMode()).toBeNull();
});
