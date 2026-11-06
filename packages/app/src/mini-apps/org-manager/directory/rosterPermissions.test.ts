import { expect, test } from "bun:test";
import {
  canCurrentUserMutateSelectedGroup,
  canDisableRosterUser,
} from "../permissions";

test("another admin cannot disable the personal org owner", () => {
  const input = {
    authUserId: "peer-2",
    canDisableRosterUsers: true,
    targetUser: {
      userId: "peer-1",
      isSelf: false,
      status: "active" as const,
      isPersonalOrganizationOwner: true,
    },
  };
  expect(canDisableRosterUser(input)).toBe(false);
  expect(
    canDisableRosterUser({
      ...input,
      targetUser: { ...input.targetUser, isPersonalOrganizationOwner: false },
    }),
  ).toBe(true);
});

test("only organization admins can change group membership", () => {
  const directory = {
    organizationId: "organization-1",
    currentUser: { isOrgAdmin: false },
    profileDocumentId: null,
    users: [],
  };
  // The API refuses group policy changes from anyone outside the built-in
  // Admins group, including a direct admin of the selected group.
  expect(canCurrentUserMutateSelectedGroup(null)).toBe(false);
  expect(canCurrentUserMutateSelectedGroup(directory)).toBe(false);
  expect(
    canCurrentUserMutateSelectedGroup({
      ...directory,
      currentUser: { isOrgAdmin: true },
    }),
  ).toBe(true);
});
