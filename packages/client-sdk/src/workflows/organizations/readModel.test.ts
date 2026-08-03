import { expect, test } from "bun:test";
import {
  groupId,
  organizationId,
  organizationPrincipalPolicy,
  principalPolicy,
  userDetail,
} from "../../../test/helpers/organizationReadModelFixtures";
import {
  buildOrganizationGroupPolicyHistory,
  buildOrganizationPolicyHistory,
  updateOrganizationProfile,
  updateOrganizationRosterEntry,
} from "./readModel";

test("buildOrganizationGroupPolicyHistory diffs policy projections", () => {
  const history = buildOrganizationGroupPolicyHistory(
    principalPolicy,
    organizationId,
  );

  expect(history.groupId).toBe(groupId);
  expect(history.organizationId).toBe(organizationId);
  expect(history.principalId).toBe(groupId);
  expect(history.principalType).toBe("group");
  expect(history.entries.map((entry) => entry.version)).toEqual([3, 2, 1]);
  expect(history.entries[0]?.changes).toEqual([
    {
      changeType: "role_changed",
      userId: "user-1",
      previousRole: "member",
      nextRole: "admin",
    },
    {
      changeType: "removed",
      userId: "user-2",
      previousRole: "member",
      nextRole: null,
    },
  ]);
  expect(history.entries[1]?.changes).toEqual([
    {
      changeType: "role_changed",
      userId: "user-1",
      previousRole: "admin",
      nextRole: "member",
    },
    {
      changeType: "added",
      userId: "user-2",
      previousRole: null,
      nextRole: "member",
    },
  ]);
  expect(history.entries[2]?.changes).toEqual([
    {
      changeType: "added",
      userId: "user-1",
      previousRole: null,
      nextRole: "admin",
    },
  ]);
});

test("buildOrganizationPolicyHistory diffs organization policy projections", () => {
  const history = buildOrganizationPolicyHistory(organizationPrincipalPolicy);

  expect(history.organizationId).toBe(organizationId);
  expect(history.principalId).toBe(organizationId);
  expect(history.principalType).toBe("organization");
  expect(history.entries.map((entry) => entry.version)).toEqual([3, 2, 1]);
  expect(history.entries[0]?.changes).toEqual([
    {
      changeType: "role_changed",
      userId: "user-1",
      previousRole: "member",
      nextRole: "admin",
    },
    {
      changeType: "removed",
      userId: "user-2",
      previousRole: "member",
      nextRole: null,
    },
  ]);
});

test("updateOrganizationRosterEntry binds encrypted profile document ids", async () => {
  const calls: string[] = [];
  const result = await updateOrganizationRosterEntry({
    apiClient: {
      updateOrganizationRosterEntry: async (
        nextOrganizationId,
        nextUserId,
        input,
      ) => {
        calls.push(
          `roster:${nextOrganizationId}:${nextUserId}:${input.profileDocumentId}`,
        );
        return {
          ...userDetail.user,
          profileDocumentId: input.profileDocumentId,
        };
      },
    },
    organizationId,
    profileDocumentId: "profile-document-1",
    userId: "user-1",
  });

  expect(calls).toEqual(["roster:org-1:user-1:profile-document-1"]);
  expect(result?.profileDocumentId).toBe("profile-document-1");
});

test("updateOrganizationProfile binds encrypted profile document ids", async () => {
  const calls: string[] = [];
  const result = await updateOrganizationProfile({
    apiClient: {
      updateOrganizationProfile: async (nextOrganizationId, input) => {
        calls.push(`profile:${nextOrganizationId}:${input.profileDocumentId}`);
        return {
          organizationId: nextOrganizationId,
          profileDocumentId: input.profileDocumentId,
        };
      },
    },
    organizationId,
    profileDocumentId: "profile-document-1",
  });

  expect(calls).toEqual(["profile:org-1:profile-document-1"]);
  expect(result?.profileDocumentId).toBe("profile-document-1");
});
