import { expect, test } from "bun:test";
import {
  getOrgManagerDataUsageScopeKey,
  scopeOrganizationDirectory,
  scopeOrganizationList,
  scopeOrganizationValue,
  scopeSelectedGroupValue,
  scopeSelectedUserDetail,
} from "./orgManagerStateScope";

function dataUsageRuntime(input: {
  readonly dbId: string;
  readonly dbStatus: string;
  readonly userId: string;
}) {
  return {
    auth: {
      isAuthenticated: true,
      organizationId: "org-a",
      userId: input.userId,
    },
    infra: { dbId: input.dbId, dbStatus: input.dbStatus },
  } as Parameters<typeof getOrgManagerDataUsageScopeKey>[0];
}

test("data usage scope follows requester storage, not database readiness", () => {
  const ready = dataUsageRuntime({
    dbId: "db-a",
    dbStatus: "ready",
    userId: "user-a",
  });
  const idle = dataUsageRuntime({
    dbId: "db-a",
    dbStatus: "idle",
    userId: "user-a",
  });
  const anotherRequester = dataUsageRuntime({
    dbId: "db-a",
    dbStatus: "ready",
    userId: "user-b",
  });

  expect(getOrgManagerDataUsageScopeKey(ready)).toBe(
    getOrgManagerDataUsageScopeKey(idle),
  );
  expect(getOrgManagerDataUsageScopeKey(ready)).not.toBe(
    getOrgManagerDataUsageScopeKey(anotherRequester),
  );
});

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
