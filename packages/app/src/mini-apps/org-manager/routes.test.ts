import { expect, test } from "bun:test";
import {
  DEFAULT_ORG_MANAGER_ROUTE,
  resolveOrgManagerRoute,
  resolveOrgManagerSelectedGroupId,
} from "./routes";

const groups = [{ groupId: "admins" }, { groupId: "members" }] as const;

test("org manager route preserves a valid selected group", () => {
  expect(resolveOrgManagerSelectedGroupId("members", groups)).toBe("members");
  expect(
    resolveOrgManagerRoute(
      { selectedGroupId: "members", view: "grants" },
      groups,
    ),
  ).toEqual({ selectedGroupId: "members", view: "grants" });
});

test("org manager route falls back to the first available group", () => {
  expect(resolveOrgManagerSelectedGroupId(null, groups)).toBe("admins");
  expect(resolveOrgManagerSelectedGroupId("missing", groups)).toBe("admins");
  expect(resolveOrgManagerRoute(DEFAULT_ORG_MANAGER_ROUTE, groups)).toEqual({
    selectedGroupId: "admins",
    view: "directory",
  });
});

test("org manager route keeps a pending group while groups are unavailable", () => {
  expect(resolveOrgManagerSelectedGroupId("admins", [])).toBeNull();
  expect(
    resolveOrgManagerRoute({ selectedGroupId: "admins", view: "groups" }, []),
  ).toEqual({ selectedGroupId: "admins", view: "groups" });
});
