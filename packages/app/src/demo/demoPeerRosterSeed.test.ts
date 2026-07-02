import { expect, test } from "bun:test";
import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationGroupMember,
  OrganizationGroupMembers,
} from "@tearleads/client-sdk";
import {
  isPeerInMemberGroup,
  isPeerOnRoster,
  memberGroupRecipients,
  planDemoPeerRosterSeed,
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
  // Same user present both in the directory and in the member group: the
  // directory recipient must win and appear once.
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
  // The peer is in the directory (e.g. disabled) but not an active roster user
  // and not yet a member-group member, so it must still be added.
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
