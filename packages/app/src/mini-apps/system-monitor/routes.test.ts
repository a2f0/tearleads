import { expect, test } from "bun:test";
import {
  formatSystemMonitorRouteSegments,
  parseSystemMonitorRouteSegments,
} from "./routes";

test("system monitor route segments cover logs and status tabs", () => {
  expect(parseSystemMonitorRouteSegments([])).toBe("logs");
  expect(parseSystemMonitorRouteSegments(["logs"])).toBe("logs");
  expect(parseSystemMonitorRouteSegments(["status"])).toBe("status");
  expect(parseSystemMonitorRouteSegments(["unknown"])).toBe("logs");

  expect(formatSystemMonitorRouteSegments("logs")).toEqual(["logs"]);
  expect(formatSystemMonitorRouteSegments("status")).toEqual(["status"]);
});
