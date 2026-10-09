import { expect, test } from "bun:test";
import type { LauncherDefinition } from "./launcherDefinition";
import { buildMiniAppPath, parseLauncherRoute } from "./routePaths";

const EmptyMiniApp = () => null;
const TEST_LAUNCHER: LauncherDefinition = {
  apps: {
    explorer: { createComponent: () => EmptyMiniApp, title: "Explorer" },
  },
};

test("launcher route parsing reads the mini-app segment from nested route paths", () => {
  expect(
    parseLauncherRoute("/app/explorer/documents/example", TEST_LAUNCHER),
  ).toEqual({ appId: "explorer", pathSegments: ["documents", "example"] });
});

test("paths outside /app/ and unknown apps read as the root route", () => {
  expect(parseLauncherRoute("/", TEST_LAUNCHER)).toEqual({
    appId: null,
    pathSegments: [],
  });
  expect(parseLauncherRoute("/app/notes/1", TEST_LAUNCHER)).toEqual({
    appId: null,
    pathSegments: [],
  });
});

test("built paths round-trip through parsing, encoding each segment", () => {
  const path = buildMiniAppPath("explorer", ["a b", "c/d"]);
  expect(path).toBe("/app/explorer/a%20b/c%2Fd");
  expect(parseLauncherRoute(path, TEST_LAUNCHER)).toEqual({
    appId: "explorer",
    pathSegments: ["a b", "c/d"],
  });
});
