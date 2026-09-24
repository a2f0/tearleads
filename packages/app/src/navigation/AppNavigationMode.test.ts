import { expect, test } from "bun:test";
import {
  type AppNavigationEnvironment,
  resolveAppNavigationMode,
} from "./AppNavigationMode";

const DESKTOP_ENVIRONMENT: AppNavigationEnvironment = {
  innerWidth: 1280,
  maxTouchPoints: 0,
  pointerCoarse: false,
  userAgent: "Mozilla/5.0",
};

test("routed navigation is the default", () => {
  expect(resolveAppNavigationMode({})).toBe("routed");
});

test("an explicit navigation mode overrides the default", () => {
  expect(resolveAppNavigationMode({ forcedMode: "windowed" })).toBe("windowed");
  expect(resolveAppNavigationMode({ forcedMode: "routed" })).toBe("routed");
});

test("the peer demo keeps windows on desktop and routes on touch or narrow screens", () => {
  expect(
    resolveAppNavigationMode({
      environment: DESKTOP_ENVIRONMENT,
      preferWindowedPeerSplit: true,
    }),
  ).toBe("windowed");
  expect(
    resolveAppNavigationMode({
      environment: { ...DESKTOP_ENVIRONMENT, innerWidth: 900 },
      preferWindowedPeerSplit: true,
    }),
  ).toBe("routed");
  expect(
    resolveAppNavigationMode({
      environment: { ...DESKTOP_ENVIRONMENT, pointerCoarse: true },
      preferWindowedPeerSplit: true,
    }),
  ).toBe("routed");
  expect(
    resolveAppNavigationMode({
      environment: { ...DESKTOP_ENVIRONMENT, userAgent: "iPad" },
      preferWindowedPeerSplit: true,
    }),
  ).toBe("routed");
  expect(
    resolveAppNavigationMode({
      environment: {
        ...DESKTOP_ENVIRONMENT,
        maxTouchPoints: 5,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      },
      preferWindowedPeerSplit: true,
    }),
  ).toBe("routed");
});
