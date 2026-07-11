import { expect, test } from "bun:test";
import {
  DEFAULT_ORG_MANAGER_ROUTE,
  formatOrgManagerGrantDetailRouteSegments,
  formatOrgManagerRouteSegments,
  type OrgManagerRoute,
  parseOrgManagerRouteSegments,
  resolveOrgManagerRoute,
  resolveOrgManagerSelectedGroupId,
} from "./routes";

const groups = [{ groupId: "admins" }, { groupId: "members" }] as const;

const MENU_ROUTE: OrgManagerRoute = {
  selectedGrantRef: null,
  selectedGroupId: null,
  view: "menu",
};

test("org manager route preserves a valid selected group", () => {
  expect(resolveOrgManagerSelectedGroupId("members", groups)).toBe("members");
  expect(
    resolveOrgManagerRoute(
      { selectedGrantRef: null, selectedGroupId: "members", view: "grants" },
      groups,
    ),
  ).toEqual({
    selectedGrantRef: null,
    selectedGroupId: "members",
    view: "grants",
  });
});

test("org manager route keeps group selection empty until a group is selected", () => {
  expect(resolveOrgManagerSelectedGroupId(null, groups)).toBeNull();
  expect(resolveOrgManagerSelectedGroupId("missing", groups)).toBeNull();
  expect(resolveOrgManagerRoute(DEFAULT_ORG_MANAGER_ROUTE, groups)).toEqual({
    selectedGrantRef: null,
    selectedGroupId: null,
    view: "directory",
  });
});

test("org manager route keeps a pending group while groups are unavailable", () => {
  expect(resolveOrgManagerSelectedGroupId("admins", [])).toBeNull();
  expect(
    resolveOrgManagerRoute(
      { selectedGrantRef: null, selectedGroupId: "admins", view: "groups" },
      [],
    ),
  ).toEqual({
    selectedGrantRef: null,
    selectedGroupId: "admins",
    view: "groups",
  });
});

test("org manager base segments resolve to the section menu", () => {
  // The segment-less base route is the compact section menu; the roster now
  // carries an explicit "directory" segment so the two are distinguishable.
  expect(parseOrgManagerRouteSegments([])).toEqual(MENU_ROUTE);
  expect(parseOrgManagerRouteSegments(["nonsense"])).toEqual(MENU_ROUTE);
  expect(parseOrgManagerRouteSegments(["directory"])).toEqual(
    DEFAULT_ORG_MANAGER_ROUTE,
  );
  expect(formatOrgManagerRouteSegments(MENU_ROUTE)).toEqual([]);
  expect(formatOrgManagerRouteSegments(DEFAULT_ORG_MANAGER_ROUTE)).toEqual([
    "directory",
  ]);
});

test("org manager route segments preserve view and selected group", () => {
  expect(parseOrgManagerRouteSegments(["groups", "admins"])).toEqual({
    selectedGrantRef: null,
    selectedGroupId: "admins",
    view: "groups",
  });
  expect(parseOrgManagerRouteSegments(["grants", "groups", "admins"])).toEqual({
    selectedGrantRef: null,
    selectedGroupId: "admins",
    view: "grants",
  });
  expect(
    parseOrgManagerRouteSegments([
      "grants",
      "detail",
      "group",
      "admins",
      "container-1",
    ]),
  ).toEqual({
    selectedGrantRef: {
      containerId: "container-1",
      subjectId: "admins",
      subjectType: "group",
    },
    selectedGroupId: null,
    view: "grants",
  });

  expect(
    formatOrgManagerRouteSegments({
      selectedGrantRef: null,
      selectedGroupId: "admins",
      view: "groups",
    }),
  ).toEqual(["groups", "admins"]);
  expect(
    formatOrgManagerRouteSegments({
      selectedGrantRef: null,
      selectedGroupId: "admins",
      view: "grants",
    }),
  ).toEqual(["grants", "groups", "admins"]);
  expect(
    formatOrgManagerRouteSegments({
      selectedGrantRef: {
        containerId: "container-1",
        subjectId: "admins",
        subjectType: "group",
      },
      selectedGroupId: null,
      view: "grants",
    }),
  ).toEqual(["grants", "detail", "group", "admins", "container-1"]);
  expect(
    formatOrgManagerGrantDetailRouteSegments({
      containerId: "container-1",
      subjectId: "admins",
      subjectType: "group",
    }),
  ).toEqual(["grants", "detail", "group", "admins", "container-1"]);
});
