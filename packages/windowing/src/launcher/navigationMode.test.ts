import { expect, test } from "bun:test";
import {
  isWindowedLayoutEligible,
  type NavigationEnvironment,
  resolveNavigationMode,
} from "./navigationMode";

const DESKTOP_ENVIRONMENT: NavigationEnvironment = {
  innerWidth: 1280,
  maxTouchPoints: 0,
  pointerCoarse: false,
  userAgent: "Mozilla/5.0",
};

test("routed navigation is the default", () => {
  expect(resolveNavigationMode({})).toBe("routed");
});

test("an explicit navigation mode overrides the default", () => {
  expect(resolveNavigationMode({ forcedMode: "windowed" })).toBe("windowed");
  expect(resolveNavigationMode({ forcedMode: "routed" })).toBe("routed");
});

test("a preferred windowed mode keeps windows on desktop and routes on touch or narrow screens", () => {
  expect(
    resolveNavigationMode({
      environment: DESKTOP_ENVIRONMENT,
      preferredMode: "windowed",
    }),
  ).toBe("windowed");
  expect(
    resolveNavigationMode({
      environment: { ...DESKTOP_ENVIRONMENT, innerWidth: 900 },
      preferredMode: "windowed",
    }),
  ).toBe("routed");
  expect(
    resolveNavigationMode({
      environment: { ...DESKTOP_ENVIRONMENT, pointerCoarse: true },
      preferredMode: "windowed",
    }),
  ).toBe("routed");
  expect(
    resolveNavigationMode({
      environment: { ...DESKTOP_ENVIRONMENT, userAgent: "iPad" },
      preferredMode: "windowed",
    }),
  ).toBe("routed");
  expect(
    resolveNavigationMode({
      environment: {
        ...DESKTOP_ENVIRONMENT,
        maxTouchPoints: 5,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      },
      preferredMode: "windowed",
    }),
  ).toBe("routed");
});

test("windowed layout is eligible only on a wide fine-pointer desktop", () => {
  expect(isWindowedLayoutEligible(DESKTOP_ENVIRONMENT)).toBe(true);
  expect(
    isWindowedLayoutEligible({ ...DESKTOP_ENVIRONMENT, innerWidth: 900 }),
  ).toBe(false);
  expect(
    isWindowedLayoutEligible({ ...DESKTOP_ENVIRONMENT, pointerCoarse: true }),
  ).toBe(false);
});
