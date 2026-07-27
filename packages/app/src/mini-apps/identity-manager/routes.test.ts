import { expect, test } from "bun:test";
import {
  formatIdentityManagerRouteSegments,
  parseIdentityManagerRouteSegments,
} from "./routes";

test("identity manager base and unknown routes resolve to the section menu", () => {
  expect(parseIdentityManagerRouteSegments([])).toBe("menu");
  expect(parseIdentityManagerRouteSegments(["unknown"])).toBe("menu");
  expect(formatIdentityManagerRouteSegments("menu")).toEqual([]);
});

test("identity manager routes preserve each section", () => {
  for (const view of [
    "general",
    "recovery-key",
    "pin-lock",
    "active-sessions",
  ] as const) {
    expect(parseIdentityManagerRouteSegments([view])).toBe(view);
    expect(formatIdentityManagerRouteSegments(view)).toEqual([view]);
  }
});
