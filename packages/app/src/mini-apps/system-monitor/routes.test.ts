import { expect, test } from "bun:test";
import {
  formatSystemMonitorRouteSegments,
  parseSystemMonitorRouteSegments,
} from "./routes";

test("system monitor route segments cover logs, status, environment, and feature flag tabs", () => {
  expect(parseSystemMonitorRouteSegments([])).toBe("logs");
  expect(parseSystemMonitorRouteSegments(["logs"])).toBe("logs");
  expect(parseSystemMonitorRouteSegments(["status"])).toBe("status");
  expect(parseSystemMonitorRouteSegments(["requests"])).toBe("requests");
  expect(parseSystemMonitorRouteSegments(["environment"])).toBe("environment");
  expect(parseSystemMonitorRouteSegments(["feature-flags"])).toBe(
    "feature-flags",
  );
  expect(parseSystemMonitorRouteSegments(["unknown"])).toBe("logs");

  expect(formatSystemMonitorRouteSegments("logs")).toEqual([]);
  expect(formatSystemMonitorRouteSegments("status")).toEqual(["status"]);
  expect(formatSystemMonitorRouteSegments("requests")).toEqual(["requests"]);
  expect(formatSystemMonitorRouteSegments("environment")).toEqual([
    "environment",
  ]);
  expect(formatSystemMonitorRouteSegments("feature-flags")).toEqual([
    "feature-flags",
  ]);
});
