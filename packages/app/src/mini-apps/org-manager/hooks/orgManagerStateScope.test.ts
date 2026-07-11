import { expect, test } from "bun:test";
import {
  scopeOrganizationDirectory,
  scopeOrganizationList,
  scopeOrganizationValue,
  scopeSelectedGroupValue,
  scopeSelectedUserDetail,
} from "./orgManagerStateScope";

test("org-manager state scope hides values from a previous organization", () => {
  const oldDirectory = { organizationId: "org-a", users: [] };
  expect(scopeOrganizationValue(oldDirectory, "org-b")).toBeNull();
  expect(
    scopeOrganizationList(
      [
        { groupId: "group-a", organizationId: "org-a" },
        { groupId: "group-b", organizationId: "org-b" },
      ],
      "org-b",
    ),
  ).toEqual([{ groupId: "group-b", organizationId: "org-b" }]);
});

test("org-manager directory scope hides another user in the same organization", () => {
  const directory = {
    organizationId: "org-a",
    users: [{ isSelf: true, userId: "user-a" }],
  } as Parameters<typeof scopeOrganizationDirectory>[0];

  expect(scopeOrganizationDirectory(directory, "org-a", "user-b")).toBeNull();
  expect(scopeOrganizationDirectory(directory, "org-a", "user-a")).toBe(
    directory,
  );
});

test("org-manager state scope hides detail from a previous selection", () => {
  const oldGroup = {
    groupId: "group-a",
    members: [],
    organizationId: "org-a",
  };
  expect(scopeSelectedGroupValue(oldGroup, "org-a", "group-b")).toBeNull();

  const oldUser = {
    organizationId: "org-a",
    user: { userId: "user-a" },
  };
  expect(
    scopeSelectedUserDetail(
      oldUser as Parameters<typeof scopeSelectedUserDetail>[0],
      "org-a",
      "user-b",
    ),
  ).toBeNull();
});
