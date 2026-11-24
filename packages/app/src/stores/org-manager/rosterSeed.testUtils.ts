import type {
  OrganizationDirectory,
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
  OrganizationGroupMember,
  OrganizationGroupMembers,
} from "@tearleads/client-sdk";
import type { RosterSeedActions } from "./rosterSeed";

export function directoryUser(
  overrides: Partial<OrganizationDirectoryUser>,
): OrganizationDirectoryUser {
  return {
    userId: "user-id",
    signingKeyFingerprint: "signing-fp",
    encapsulationKeyFingerprint: "encap-fp",
    createdAt: "2026-01-01T00:00:00.000Z",
    isPersonalOrganizationOwner: false,
    isSelf: false,
    status: "active",
    profileDocumentId: null,
    joinedAt: "2026-01-01T00:00:00.000Z",
    leaveRequest: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    disabledAt: null,
    disabledByUserId: null,
    ...overrides,
  };
}

export function directory(
  overrides: Partial<OrganizationDirectory>,
): OrganizationDirectory {
  return {
    organizationId: "org-id",
    profileDocumentId: null,
    currentUser: { isOrgAdmin: true },
    users: [],
    ...overrides,
  };
}

export function member(
  overrides: Partial<OrganizationGroupMember>,
): OrganizationGroupMember {
  return {
    role: "member",
    userId: "member-id",
    ...overrides,
  };
}

export function members(
  memberList: OrganizationGroupMember[],
): OrganizationGroupMembers {
  return {
    organizationId: "org-id",
    groupId: "member-group",
    members: memberList,
  };
}

export function directoryAndGroups(input: {
  users: OrganizationDirectoryUser[];
  memberGroupId: string;
}): OrganizationDirectoryAndGroups {
  return {
    directory: directory({ users: input.users }),
    groups: [],
    memberGroupId: input.memberGroupId,
    readModelCursor: "cursor-1",
  };
}

export function fakeRosterSeedActions(overrides: {
  directoryAndGroups?: OrganizationDirectoryAndGroups | null;
  members?: OrganizationGroupMembers | null;
  ensuredUser?: OrganizationDirectoryUser | null;
}) {
  const calls = {
    addUserToGroup: 0,
    ensureRosterProfileDocument: 0,
  };
  let ensureArgs: { userId: string; nickname: string | undefined } | null =
    null;
  let addArgs: {
    groupId: string;
    targetUserId: string;
    groupName: string;
  } | null = null;
  const actions: RosterSeedActions = {
    loadDirectoryAndGroups: () =>
      Promise.resolve(overrides.directoryAndGroups ?? null),
    loadGroupMembers: () => Promise.resolve(overrides.members ?? null),
    addUserToGroup: (groupId, targetUserId, groupName) => {
      calls.addUserToGroup += 1;
      addArgs = { groupId, targetUserId, groupName };
      return Promise.resolve({});
    },
    ensureRosterProfileDocument: (user, names) => {
      calls.ensureRosterProfileDocument += 1;
      ensureArgs = { userId: user.userId, nickname: names?.nickname };
      return Promise.resolve(overrides.ensuredUser ?? null);
    },
  };
  return {
    actions,
    calls,
    getAddArgs: () => addArgs,
    getEnsureArgs: () => ensureArgs,
  };
}
