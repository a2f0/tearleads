import { expect, test } from "bun:test";
import {
  formatRootRouteSegments,
  parseRootRouteSegments,
  rootRouteForView,
} from "./routes";

test("root routes round-trip through path segments", () => {
  expect(parseRootRouteSegments([])).toEqual({ view: "menu" });
  expect(parseRootRouteSegments(["identities"])).toEqual({
    userId: null,
    view: "identities",
  });
  expect(parseRootRouteSegments(["identities", "user-1"])).toEqual({
    userId: "user-1",
    view: "identities",
  });
  expect(parseRootRouteSegments(["unknown"])).toEqual({ view: "menu" });

  expect(formatRootRouteSegments({ view: "menu" })).toEqual([]);
  expect(formatRootRouteSegments({ userId: null, view: "identities" })).toEqual(
    ["identities"],
  );
  expect(
    formatRootRouteSegments({ userId: "user-1", view: "identities" }),
  ).toEqual(["identities", "user-1"]);
  expect(rootRouteForView("identities")).toEqual({
    userId: null,
    view: "identities",
  });
  expect(rootRouteForView("menu")).toEqual({ view: "menu" });
});
