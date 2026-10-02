import { expect, mock, test } from "bun:test";
import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import { ORG_MANAGER_LABELS } from "../labels";
import { loadRosterDisableMembershipTargets } from "./rosterDisableMembershipTargets";

function group(groupId: string): OrganizationGroupSummary {
  return {
    groupId,
    name: groupId,
    nameUnreadable: false,
    organizationId: "org",
    createdAt: "2026-09-27T00:00:00.000Z",
    currentState: null,
    isBuiltin: groupId === "Admins",
  };
}

function fixture() {
  return {
    disabledUserId: "removed-user",
    groups: [
      group("Members"),
      group("Admins"),
      group("Ordinary"),
      group("Unrelated"),
    ],
    memberGroupId: "Members",
    organizationId: "org",
    isOperationActive: () => true,
    setError: mock((_message: string) => {}),
    orgManagerActions: {
      loadGroupMembers: mock(async (groupId: string) => ({
        groupId,
        organizationId: "org",
        members:
          groupId === "Unrelated"
            ? []
            : [
                {
                  userId: "removed-user",
                  role: "member" as const,
                  encapsulationKeyFingerprint: null,
                  encapsulationPublicKey: null,
                  signingKeyFingerprint: null,
                  signingPublicKey: null,
                },
              ],
      })),
    },
  };
}

test("disable removes ordinary memberships and Admins before Members", async () => {
  const input = fixture();
  expect(await loadRosterDisableMembershipTargets(input)).toEqual([
    { groupId: "Admins", name: "Admins" },
    { groupId: "Ordinary", name: "Ordinary" },
    { groupId: "Members", name: "Members" },
  ]);
  expect(input.orgManagerActions.loadGroupMembers).toHaveBeenCalledTimes(4);
  expect(input.setError).not.toHaveBeenCalled();
});

test("failed ordinary membership lookup prevents roster removal", async () => {
  const input = fixture();
  const result = await loadRosterDisableMembershipTargets({
    ...input,
    orgManagerActions: {
      loadGroupMembers: async (groupId) =>
        groupId === "Ordinary"
          ? null
          : input.orgManagerActions.loadGroupMembers(groupId),
    },
  });
  expect(result).toBeNull();
  expect(input.setError).toHaveBeenCalledWith(
    ORG_MANAGER_LABELS.failedLoadGroupMembers,
  );
});

test("changing organizations during lookup prevents roster removal", async () => {
  const input = fixture();
  expect(
    await loadRosterDisableMembershipTargets({
      ...input,
      isOperationActive: () => false,
    }),
  ).toBeNull();
  expect(input.setError).not.toHaveBeenCalled();
});
