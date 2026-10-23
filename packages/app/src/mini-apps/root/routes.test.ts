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

test("organization routes and identity return paths survive URL round trips", () => {
  for (const segments of [
    ["organizations"],
    ["organizations", "org-1"],
    ["reports"],
    ["organizations", "org-1", "data-usage", "reports"],
    ["organizations", "org-1", "data-usage"],
    ["organizations", "org-1", "identities"],
    ["identities", "user-1", "organizations", "org-1"],
    ["identities", "user-1", "organizations", "org-1", "reports"],
    ["identities", "user-1", "organizations", "org-1", "billing"],
    ["identities", "user-1", "organizations", "org-1", "billing", "reports"],
  ]) {
    expect(formatRootRouteSegments(parseRootRouteSegments(segments))).toEqual(
      segments,
    );
  }
  expect(rootRouteForView("organizations")).toEqual({
    organizationId: null,
    view: "organizations",
  });
});

test("identity routes return to Reports directly or through an organization", () => {
  expect(
    parseRootRouteSegments([
      "identities",
      "user-1",
      "organizations",
      "org-1",
      "reports",
    ]),
  ).toEqual({
    view: "identities",
    userId: "user-1",
    returnOrganizationId: "org-1",
    returnView: "reports",
  });
  // The RevenueCat report links a delivery's buyer straight to identity detail.
  expect(parseRootRouteSegments(["identities", "user-1", "reports"])).toEqual({
    view: "identities",
    userId: "user-1",
    returnView: "reports",
  });
  expect(
    formatRootRouteSegments({
      returnView: "reports",
      userId: "user-1",
      view: "identities",
    }),
  ).toEqual(["identities", "user-1", "reports"]);
});

test("audit routes keep their subject through URL round trips", () => {
  expect(parseRootRouteSegments(["audit"])).toEqual({
    subjectId: null,
    view: "audit",
  });
  expect(parseRootRouteSegments(["audit", "user-1"])).toEqual({
    subjectId: "user-1",
    view: "audit",
  });
  expect(formatRootRouteSegments({ subjectId: null, view: "audit" })).toEqual([
    "audit",
  ]);
  expect(
    formatRootRouteSegments({ subjectId: "user-1", view: "audit" }),
  ).toEqual(["audit", "user-1"]);
  expect(rootRouteForView("audit")).toEqual({ subjectId: null, view: "audit" });
});

test("details opened from the audit trail return to it with its subject", () => {
  for (const segments of [
    ["identities", "user-1", "audit"],
    ["identities", "user-1", "audit", "user-2"],
    ["identities", "user-1", "organizations", "org-1", "audit", "user-2"],
    ["organizations", "org-1", "overview", "audit"],
    ["organizations", "org-1", "identities", "audit", "user-2"],
  ]) {
    expect(formatRootRouteSegments(parseRootRouteSegments(segments))).toEqual(
      segments,
    );
  }
  expect(
    parseRootRouteSegments([
      "organizations",
      "org-1",
      "overview",
      "audit",
      "user-2",
    ]),
  ).toEqual({
    organizationId: "org-1",
    returnSubjectId: "user-2",
    returnView: "audit",
    tab: "overview",
    view: "organizations",
  });
});
