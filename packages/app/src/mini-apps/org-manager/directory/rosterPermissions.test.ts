import { expect, test } from "bun:test";
import { canDisableRosterUser } from "../permissions";

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
