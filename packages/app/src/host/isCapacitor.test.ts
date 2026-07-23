import { afterEach, expect, test } from "bun:test";
import { isCapacitor } from "./isCapacitor";

// The bridge the native shell installs is absent in this (browser-shaped) test
// environment, so each case installs its own shape and restores after.
afterEach(() => {
  delete window.Capacitor;
});

test("reports false when no Capacitor bridge is installed", () => {
  expect(isCapacitor()).toBe(false);
});

test("reports true inside the native shell", () => {
  window.Capacitor = { isNativePlatform: () => true };
  expect(isCapacitor()).toBe(true);
});

test("reports false in the capacitor web dev shell", () => {
  window.Capacitor = { isNativePlatform: () => false };
  expect(isCapacitor()).toBe(false);
});

test("reports false for a bridge that predates isNativePlatform", () => {
  window.Capacitor = {};
  expect(isCapacitor()).toBe(false);
});
