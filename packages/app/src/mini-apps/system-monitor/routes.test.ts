import { expect, test } from "bun:test";
import {
  formatSystemMonitorRouteSegments,
  parseSystemMonitorRouteSegments,
} from "./routes";

test("system monitor route segments cover logs, status, and feature flag tabs", () => {
  expect(parseSystemMonitorRouteSegments([])).toBe("logs");
  expect(parseSystemMonitorRouteSegments(["logs"])).toBe("logs");
  expect(parseSystemMonitorRouteSegments(["status"])).toBe("status");
  expect(parseSystemMonitorRouteSegments(["feature-flags"])).toBe(
    "feature-flags",
  );
  expect(parseSystemMonitorRouteSegments(["unknown"])).toBe("logs");

  expect(formatSystemMonitorRouteSegments("logs")).toEqual([]);
  expect(formatSystemMonitorRouteSegments("status")).toEqual(["status"]);
  expect(formatSystemMonitorRouteSegments("feature-flags")).toEqual([
    "feature-flags",
  ]);
});
