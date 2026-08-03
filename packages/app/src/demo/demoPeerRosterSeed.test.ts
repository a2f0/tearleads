import { expect, test } from "bun:test";
import type {
  OrganizationDirectory,
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
  OrganizationGroupMember,
  OrganizationGroupMembers,
} from "@tearleads/client-sdk";
import { KeyingVerificationError } from "@tearleads/crypto";
import {
  attemptPeerRosterSeed,
  type DemoRosterSeedActions,
  isPeerInMemberGroup,
  isPeerOnRoster,
  planDemoPeerRosterSeed,
  seedPeerRosterEntry,
  shouldAttemptRosterSeed,
} from "./demoPeerRosterSeed";

function directoryUser(
  overrides: Partial<OrganizationDirectoryUser>,
): OrganizationDirectoryUser {
  return {
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
    updatedAt: "2026-01-01T00:00:00.000Z",
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
    role: "member",
    userId: "member-id",
    signingKeyFingerprint: "signing-fp",
    signingPublicKey: "signing-pub",
    encapsulationPublicKey: "encap-pub",
    encapsulationKeyFingerprint: "encap-fp",
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

test("isPeerInMemberGroup matches only a member with the peer's id", () => {
  expect(
    isPeerInMemberGroup(members([member({ userId: "peer" })]), "peer"),
  ).toBe(true);
  expect(
    isPeerInMemberGroup(members([member({ userId: "someone-else" })]), "peer"),
  ).toBe(false);
  expect(isPeerInMemberGroup(members([]), "peer")).toBe(false);
  expect(isPeerInMemberGroup(null, "peer")).toBe(false);
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
      members: members([member({ userId: "self" })]),
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
        member({ userId: "self" }),
        member({ userId: "peer" }),
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
    members: members([member({ userId: "self" })]),
    peerUserId: "peer",
  });

  expect(plan).toEqual({
    kind: "add-to-member-group",
    memberGroupId: "member-group",
    peerUserId: "peer",
    requiresImport: true,
  });
});

test("planDemoPeerRosterSeed skips import for a known-but-unseeded peer", () => {
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
    members: members([member({ userId: "self" })]),
    peerUserId: "peer",
  });

  expect(plan.kind).toBe("add-to-member-group");
  if (plan.kind === "add-to-member-group") {
    expect(plan.requiresImport).toBe(false);
  }
});

test("planDemoPeerRosterSeed does not trust the projected admin flag", () => {
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
  expect(plan).not.toHaveProperty("canAdministerOrganization");
});

function directoryAndGroups(input: {
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

const importedPeer = { userId: "peer" };

function fakeRosterSeedActions(overrides: {
  directoryAndGroups?: OrganizationDirectoryAndGroups | null;
  members?: OrganizationGroupMembers | null;
  importedUser?: { readonly userId: string } | null;
  ensuredUser?: OrganizationDirectoryUser | null;
}) {
  const calls = {
    addUserToGroup: 0,
    ensureRosterProfileDocument: 0,
    importUserById: 0,
  };
  let ensureArgs: { userId: string; nickname: string | undefined } | null =
    null;
  let addArgs: {
    groupId: string;
    targetUserId: string;
  } | null = null;
  const actions: DemoRosterSeedActions = {
    loadDirectoryAndGroups: () =>
      Promise.resolve(overrides.directoryAndGroups ?? null),
    loadGroupMembers: () => Promise.resolve(overrides.members ?? null),
    importUserById: () => {
      calls.importUserById += 1;
      return Promise.resolve(overrides.importedUser ?? null);
    },
    addUserToGroup: (groupId, targetUserId) => {
      calls.addUserToGroup += 1;
      addArgs = { groupId, targetUserId };
      return Promise.resolve({});
    },
    ensureRosterProfileDocument: (user, nickname) => {
      calls.ensureRosterProfileDocument += 1;
      ensureArgs = { userId: user.userId, nickname };
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

test("seedPeerRosterEntry adds the peer to the member group, then retries", async () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const { actions, calls, getAddArgs } = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({
      users: [self],
      memberGroupId: "mg",
    }),
    members: members([member({ userId: "self" })]),
    importedUser: importedPeer,
  });

  // Phase 1 issues the membership write but does not settle: the roster entry
  // is not in this directory snapshot yet, so the caller must retry.
  expect(await seedPeerRosterEntry(actions, "peer", "Peer 2")).toBe(false);
  expect(calls.importUserById).toBe(1);
  expect(calls.addUserToGroup).toBe(1);
  expect(getAddArgs()).toEqual({
    groupId: "mg",
    targetUserId: "peer",
  });
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
      member({ userId: "self" }),
      member({ userId: "peer" }),
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

test("seedPeerRosterEntry waits when directory, members, or peer import is unavailable", async () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const noDirectory = fakeRosterSeedActions({ directoryAndGroups: null });
  expect(await seedPeerRosterEntry(noDirectory.actions, "peer", "Peer 2")).toBe(
    false,
  );

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
    members: members([member({ userId: "self" })]),
    importedUser: null,
  });
  expect(
    await seedPeerRosterEntry(unimportablePeer.actions, "peer", "Peer 2"),
  ).toBe(false);
  expect(unimportablePeer.calls.addUserToGroup).toBe(0);
  expect(unimportablePeer.calls.importUserById).toBe(1);
});

test("attemptPeerRosterSeed retries ordinary failures but preserves integrity failures", async () => {
  const fixture = fakeRosterSeedActions({ directoryAndGroups: null });
  const transient = new Error("directory is not ready");
  const integrity = new KeyingVerificationError(
    "equivocation",
    "peer identity changed",
  );
  const logged: unknown[] = [];
  const logError = (_message: string, error: unknown) => logged.push(error);

  await expect(
    attemptPeerRosterSeed(
      {
        ...fixture.actions,
        loadDirectoryAndGroups: async () => {
          throw transient;
        },
      },
      "peer",
      "Peer 2",
      logError,
    ),
  ).resolves.toBe(false);
  expect(logged).toEqual([transient]);

  await expect(
    attemptPeerRosterSeed(
      {
        ...fixture.actions,
        loadDirectoryAndGroups: async () => {
          throw integrity;
        },
      },
      "peer",
      "Peer 2",
      logError,
    ),
  ).rejects.toBe(integrity);
  expect(logged).toEqual([transient]);
});
