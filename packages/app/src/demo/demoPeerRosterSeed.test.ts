import { expect, test } from "bun:test";
import type {
  OrganizationDirectory,
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
  OrganizationGroupMember,
  OrganizationGroupMembers,
  OrganizationUserRecipient,
} from "@tearleads/client-sdk";
import {
  type DemoRosterSeedActions,
  isPeerInMemberGroup,
  isPeerOnRoster,
  memberGroupRecipients,
  planDemoPeerRosterSeed,
  seedPeerRosterEntry,
  shouldAttemptRosterSeed,
} from "./demoPeerRosterSeed";

function directoryUser(
  overrides: Partial<OrganizationDirectoryUser>,
): OrganizationDirectoryUser {
  return {
    accountStatus: "active",
    userId: "user-id",
    signingKeyFingerprint: "signing-fp",
    signingPublicKey: "signing-pub",
    encapsulationPublicKey: "encap-pub",
    encapsulationKeyFingerprint: "encap-fp",
    createdAt: "2026-01-01T00:00:00.000Z",
    isSelf: false,
    status: "active",
    profileDocumentId: null,
    joinedAt: "2026-01-01T00:00:00.000Z",
    disabledAt: null,
    disabledByUserId: null,
    ...overrides,
  };
}

function directory(
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

function member(
  overrides: Partial<OrganizationGroupMember>,
): OrganizationGroupMember {
  return {
    memberPrincipalType: "user",
    memberPrincipalId: "member-id",
    role: "member",
    userId: "member-id",
    signingKeyFingerprint: "signing-fp",
    signingPublicKey: "signing-pub",
    encapsulationPublicKey: "encap-pub",
    encapsulationKeyFingerprint: "encap-fp",
    groupId: null,
    groupName: null,
    ...overrides,
  };
}

function members(
  memberList: OrganizationGroupMember[],
): OrganizationGroupMembers {
  return {
    organizationId: "org-id",
    groupId: "member-group",
    members: memberList,
  };
}

test("shouldAttemptRosterSeed requires write access, auth, and a peer id", () => {
  expect(
    shouldAttemptRosterSeed({
      canWrite: true,
      isAuthenticated: true,
      peerUserId: "peer",
    }),
  ).toBe(true);
  expect(
    shouldAttemptRosterSeed({
      canWrite: false,
      isAuthenticated: true,
      peerUserId: "peer",
    }),
  ).toBe(false);
  expect(
    shouldAttemptRosterSeed({
      canWrite: true,
      isAuthenticated: false,
      peerUserId: "peer",
    }),
  ).toBe(false);
  for (const peerUserId of [null, "", "   "]) {
    expect(
      shouldAttemptRosterSeed({
        canWrite: true,
        isAuthenticated: true,
        peerUserId,
      }),
    ).toBe(false);
  }
});

test("isPeerOnRoster only matches an active directory entry for the peer", () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const activePeer = directoryUser({ userId: "peer", status: "active" });
  const disabledPeer = directoryUser({ userId: "peer", status: "disabled" });

  expect(isPeerOnRoster(directory({ users: [self, activePeer] }), "peer")).toBe(
    true,
  );
  expect(
    isPeerOnRoster(directory({ users: [self, disabledPeer] }), "peer"),
  ).toBe(false);
  expect(isPeerOnRoster(directory({ users: [self] }), "peer")).toBe(false);
});

test("isPeerInMemberGroup matches only a user member with the peer's id", () => {
  expect(
    isPeerInMemberGroup(
      members([member({ memberPrincipalId: "peer" })]),
      "peer",
    ),
  ).toBe(true);
  expect(
    isPeerInMemberGroup(
      members([
        member({
          memberPrincipalType: "group",
          memberPrincipalId: "peer",
        }),
      ]),
      "peer",
    ),
  ).toBe(false);
  expect(isPeerInMemberGroup(members([]), "peer")).toBe(false);
  expect(isPeerInMemberGroup(null, "peer")).toBe(false);
});

test("memberGroupRecipients dedupes directory and member users by id", () => {
  const self = directoryUser({
    userId: "self",
    encapsulationPublicKey: "self-pub",
    encapsulationKeyFingerprint: "self-fp",
  });
  const memberOnly = member({
    memberPrincipalId: "member-only",
    encapsulationPublicKey: "member-pub",
    encapsulationKeyFingerprint: "member-fp",
  });
  const overlap = member({
    memberPrincipalId: "self",
    encapsulationPublicKey: "stale-pub",
    encapsulationKeyFingerprint: "stale-fp",
  });

  const recipients = memberGroupRecipients({
    directory: directory({ users: [self] }),
    members: members([memberOnly, overlap]),
  });

  expect(recipients).toHaveLength(2);
  expect(recipients).toContainEqual({
    userId: "self",
    encapsulationPublicKey: "self-pub",
    encapsulationKeyFingerprint: "self-fp",
  });
  expect(recipients).toContainEqual({
    userId: "member-only",
    encapsulationPublicKey: "member-pub",
    encapsulationKeyFingerprint: "member-fp",
  });
});

test("memberGroupRecipients skips non-user or keyless members", () => {
  const recipients = memberGroupRecipients({
    directory: directory({ users: [] }),
    members: members([
      member({ memberPrincipalType: "group", memberPrincipalId: "grp" }),
      member({
        memberPrincipalId: "no-keys",
        encapsulationPublicKey: null,
        encapsulationKeyFingerprint: null,
      }),
    ]),
  });

  expect(recipients).toEqual([]);
});

test("planDemoPeerRosterSeed is idle until directory and member group load", () => {
  expect(
    planDemoPeerRosterSeed({
      directory: null,
      memberGroupId: "member-group",
      members: null,
      peerUserId: "peer",
    }),
  ).toEqual({ kind: "idle" });
  expect(
    planDemoPeerRosterSeed({
      directory: directory({ users: [] }),
      memberGroupId: null,
      members: null,
      peerUserId: "peer",
    }),
  ).toEqual({ kind: "idle" });
});

test("planDemoPeerRosterSeed is idle once the peer is on the roster", () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const peer = directoryUser({ userId: "peer", status: "active" });
  expect(
    planDemoPeerRosterSeed({
      directory: directory({ users: [self, peer] }),
      memberGroupId: "member-group",
      members: members([member({ memberPrincipalId: "self" })]),
      peerUserId: "peer",
    }),
  ).toEqual({ kind: "idle" });
});

test("planDemoPeerRosterSeed is idle once the peer is a member-group user", () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  expect(
    planDemoPeerRosterSeed({
      directory: directory({ users: [self] }),
      memberGroupId: "member-group",
      members: members([
        member({ memberPrincipalId: "self" }),
        member({ memberPrincipalId: "peer" }),
      ]),
      peerUserId: "peer",
    }),
  ).toEqual({ kind: "idle" });
});

test("planDemoPeerRosterSeed plans an import-and-add when the peer is unknown", () => {
  const self = directoryUser({
    userId: "self",
    isSelf: true,
    encapsulationPublicKey: "self-pub",
    encapsulationKeyFingerprint: "self-fp",
  });
  const plan = planDemoPeerRosterSeed({
    directory: directory({ users: [self] }),
    memberGroupId: "member-group",
    members: members([member({ memberPrincipalId: "self" })]),
    peerUserId: "peer",
  });

  expect(plan).toEqual({
    kind: "add-to-member-group",
    canAdministerOrganization: true,
    currentUsers: [
      {
        userId: "self",
        encapsulationPublicKey: "self-pub",
        encapsulationKeyFingerprint: "self-fp",
      },
    ],
    existingRecipient: null,
    memberGroupId: "member-group",
    peerUserId: "peer",
  });
});

test("planDemoPeerRosterSeed reuses a directory recipient for a known-but-unseeded peer", () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const peer = directoryUser({
    userId: "peer",
    status: "disabled",
    encapsulationPublicKey: "peer-pub",
    encapsulationKeyFingerprint: "peer-fp",
  });
  const plan = planDemoPeerRosterSeed({
    directory: directory({ users: [self, peer] }),
    memberGroupId: "member-group",
    members: members([member({ memberPrincipalId: "self" })]),
    peerUserId: "peer",
  });

  expect(plan.kind).toBe("add-to-member-group");
  if (plan.kind === "add-to-member-group") {
    expect(plan.existingRecipient).toEqual({
      userId: "peer",
      encapsulationPublicKey: "peer-pub",
      encapsulationKeyFingerprint: "peer-fp",
    });
  }
});

test("planDemoPeerRosterSeed carries the non-admin flag through the add plan", () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const plan = planDemoPeerRosterSeed({
    directory: directory({
      currentUser: { isOrgAdmin: false },
      users: [self],
    }),
    memberGroupId: "member-group",
    members: null,
    peerUserId: "peer",
  });

  expect(plan.kind).toBe("add-to-member-group");
  if (plan.kind === "add-to-member-group") {
    expect(plan.canAdministerOrganization).toBe(false);
  }
});

function directoryAndGroups(input: {
  users: OrganizationDirectoryUser[];
  memberGroupId: string | null;
}): OrganizationDirectoryAndGroups {
  return {
    directory: directory({ users: input.users }),
    groups: [],
    memberGroupId: input.memberGroupId,
  };
}

const peerRecipient: OrganizationUserRecipient = {
  userId: "peer",
  encapsulationPublicKey: "peer-pub",
  encapsulationKeyFingerprint: "peer-fp",
};

function fakeRosterSeedActions(overrides: {
  directoryAndGroups?: OrganizationDirectoryAndGroups | null;
  members?: OrganizationGroupMembers | null;
  importedUser?: OrganizationUserRecipient | null;
  ensuredUser?: OrganizationDirectoryUser | null;
}) {
  const calls = {
    addUserToGroup: 0,
    ensureRosterProfileDocument: 0,
    importUserById: 0,
  };
  let ensureArgs: { userId: string; nickname: string | undefined } | null =
    null;
  const actions: DemoRosterSeedActions = {
    loadDirectoryAndGroups: () =>
      Promise.resolve(overrides.directoryAndGroups ?? null),
    loadGroupDetails: () =>
      Promise.resolve({ members: overrides.members ?? null }),
    importUserById: () => {
      calls.importUserById += 1;
      return Promise.resolve(overrides.importedUser ?? null);
    },
    addUserToGroup: () => {
      calls.addUserToGroup += 1;
      return Promise.resolve({});
    },
    ensureRosterProfileDocument: (user, nickname) => {
      calls.ensureRosterProfileDocument += 1;
      ensureArgs = { userId: user.userId, nickname };
      return Promise.resolve(overrides.ensuredUser ?? null);
    },
  };
  return { actions, calls, getEnsureArgs: () => ensureArgs };
}

test("seedPeerRosterEntry adds the peer to the member group, then retries", async () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const { actions, calls } = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({
      users: [self],
      memberGroupId: "mg",
    }),
    members: members([member({ memberPrincipalId: "self" })]),
    importedUser: peerRecipient,
  });

  // Phase 1 issues the membership write but does not settle: the roster entry
  // is not in this directory snapshot yet, so the caller must retry.
  expect(await seedPeerRosterEntry(actions, "peer", "Peer 2")).toBe(false);
  expect(calls.importUserById).toBe(1);
  expect(calls.addUserToGroup).toBe(1);
  expect(calls.ensureRosterProfileDocument).toBe(0);
});

test("seedPeerRosterEntry does not re-add a peer already in the member group", async () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const { actions, calls } = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({
      users: [self],
      memberGroupId: "mg",
    }),
    members: members([
      member({ memberPrincipalId: "self" }),
      member({ memberPrincipalId: "peer" }),
    ]),
  });

  expect(await seedPeerRosterEntry(actions, "peer", "Peer 2")).toBe(false);
  expect(calls.addUserToGroup).toBe(0);
});

test("seedPeerRosterEntry seeds the peer roster nickname once the peer is active", async () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const peer = directoryUser({ userId: "peer", status: "active" });
  const { actions, calls, getEnsureArgs } = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({
      users: [self, peer],
      memberGroupId: "mg",
    }),
    ensuredUser: directoryUser({ userId: "peer", profileDocumentId: "doc-1" }),
  });

  expect(await seedPeerRosterEntry(actions, "peer", "Peer 2")).toBe(true);
  expect(calls.ensureRosterProfileDocument).toBe(1);
  expect(getEnsureArgs()).toEqual({ userId: "peer", nickname: "Peer 2" });
});

test("seedPeerRosterEntry retries when the peer roster profile cannot be created yet", async () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const peer = directoryUser({ userId: "peer", status: "active" });
  const { actions, calls } = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({
      users: [self, peer],
      memberGroupId: "mg",
    }),
    ensuredUser: null,
  });

  expect(await seedPeerRosterEntry(actions, "peer", "Peer 2")).toBe(false);
  expect(calls.ensureRosterProfileDocument).toBe(1);
});

test("seedPeerRosterEntry is settled once the peer has a profile document", async () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const peer = directoryUser({
    userId: "peer",
    status: "active",
    profileDocumentId: "doc-1",
  });
  const { actions, calls } = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({
      users: [self, peer],
      memberGroupId: "mg",
    }),
  });

  expect(await seedPeerRosterEntry(actions, "peer", "Peer 2")).toBe(true);
  expect(calls.ensureRosterProfileDocument).toBe(0);
});

test("seedPeerRosterEntry waits when directory, member group, or peer key is unavailable", async () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const noDirectory = fakeRosterSeedActions({ directoryAndGroups: null });
  expect(await seedPeerRosterEntry(noDirectory.actions, "peer", "Peer 2")).toBe(
    false,
  );

  const noMemberGroup = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({
      users: [self],
      memberGroupId: null,
    }),
  });
  expect(
    await seedPeerRosterEntry(noMemberGroup.actions, "peer", "Peer 2"),
  ).toBe(false);

  const noMembers = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({
      users: [self],
      memberGroupId: "mg",
    }),
    members: null,
  });
  expect(await seedPeerRosterEntry(noMembers.actions, "peer", "Peer 2")).toBe(
    false,
  );
  expect(noMembers.calls.addUserToGroup).toBe(0);

  const unimportablePeer = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({
      users: [self],
      memberGroupId: "mg",
    }),
    members: members([member({ memberPrincipalId: "self" })]),
    importedUser: null,
  });
  expect(
    await seedPeerRosterEntry(unimportablePeer.actions, "peer", "Peer 2"),
  ).toBe(false);
  expect(unimportablePeer.calls.addUserToGroup).toBe(0);
  expect(unimportablePeer.calls.importUserById).toBe(1);
});
