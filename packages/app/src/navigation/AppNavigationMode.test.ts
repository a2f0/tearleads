import { expect, test } from "bun:test";
import {
  type AppNavigationEnvironment,
  resolveAppNavigationMode,
} from "./AppNavigationMode";

const DESKTOP_ENVIRONMENT = {
  innerWidth: 1280,
  maxTouchPoints: 0,
  pointerCoarse: false,
  userAgent: "Mozilla/5.0",
} satisfies AppNavigationEnvironment;

test("forced navigation mode wins over device traits", () => {
  expect(
    resolveAppNavigationMode({
      environment: {
        ...DESKTOP_ENVIRONMENT,
        innerWidth: 390,
        pointerCoarse: true,
      },
      forcedMode: "windowed",
    }),
  ).toBe("windowed");

  expect(
    resolveAppNavigationMode({
      environment: DESKTOP_ENVIRONMENT,
      forcedMode: "routed",
    }),
  ).toBe("routed");
});

test("small and coarse-pointer devices use routed navigation", () => {
  expect(
    resolveAppNavigationMode({
      environment: {
        ...DESKTOP_ENVIRONMENT,
        innerWidth: 760,
      },
    }),
  ).toBe("routed");

  expect(
    resolveAppNavigationMode({
      environment: {
        ...DESKTOP_ENVIRONMENT,
        pointerCoarse: true,
      },
    }),
  ).toBe("routed");
});

test("ipad-like browsers use routed navigation", () => {
  expect(
    resolveAppNavigationMode({
      environment: {
        ...DESKTOP_ENVIRONMENT,
        maxTouchPoints: 5,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      },
    }),
  ).toBe("routed");
});

test("desktop browsers use windowed navigation", () => {
  expect(
    resolveAppNavigationMode({
      environment: DESKTOP_ENVIRONMENT,
    }),
  ).toBe("windowed");
});
