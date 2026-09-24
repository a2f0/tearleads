import { expect, test } from "bun:test";
import { resolveAppNavigationMode } from "./AppNavigationMode";

test("routed navigation is the default", () => {
  expect(resolveAppNavigationMode({})).toBe("routed");
});

test("an explicit navigation mode overrides the default", () => {
  expect(resolveAppNavigationMode({ forcedMode: "windowed" })).toBe("windowed");
  expect(resolveAppNavigationMode({ forcedMode: "routed" })).toBe("routed");
});
