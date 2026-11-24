import { expect, test } from "bun:test";
import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import {
  createGroupMembersSeed,
  isUserInGroup,
  isUserOnRoster,
  planRosterAdmission,
  seedRosterEntry,
} from "./rosterSeed";
import {
  directory,
  directoryAndGroups,
  directoryUser,
  fakeRosterSeedActions,
  member,
  members,
} from "./rosterSeed.testUtils";

test("isUserOnRoster only matches an active directory entry for the peer", () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const activePeer = directoryUser({ userId: "peer", status: "active" });
  const disabledPeer = directoryUser({ userId: "peer", status: "disabled" });

  expect(isUserOnRoster(directory({ users: [self, activePeer] }), "peer")).toBe(
    true,
  );
  expect(
    isUserOnRoster(directory({ users: [self, disabledPeer] }), "peer"),
  ).toBe(false);
  expect(isUserOnRoster(directory({ users: [self] }), "peer")).toBe(false);
});

test("isUserInGroup matches only a member with the peer's id", () => {
  expect(isUserInGroup(members([member({ userId: "peer" })]), "peer")).toBe(
    true,
  );
  expect(
    isUserInGroup(members([member({ userId: "someone-else" })]), "peer"),
  ).toBe(false);
  expect(isUserInGroup(members([]), "peer")).toBe(false);
  expect(isUserInGroup(null, "peer")).toBe(false);
});

test("planRosterAdmission is idle until directory and member group load", () => {
  expect(
    planRosterAdmission({
      directory: null,
      memberGroupId: "member-group",
      members: null,
      userId: "peer",
    }),
  ).toEqual({ kind: "idle" });
  expect(
    planRosterAdmission({
      directory: directory({ users: [] }),
      memberGroupId: null,
      members: null,
      userId: "peer",
    }),
  ).toEqual({ kind: "idle" });
});

test("planRosterAdmission is idle once the peer is on the roster", () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const peer = directoryUser({ userId: "peer", status: "active" });
  expect(
    planRosterAdmission({
      directory: directory({ users: [self, peer] }),
      memberGroupId: "member-group",
      members: members([member({ userId: "self" })]),
      userId: "peer",
    }),
  ).toEqual({ kind: "idle" });
});

test("planRosterAdmission is idle once the peer is a member-group user", () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  expect(
    planRosterAdmission({
      directory: directory({ users: [self] }),
      memberGroupId: "member-group",
      members: members([
        member({ userId: "self" }),
        member({ userId: "peer" }),
      ]),
      userId: "peer",
    }),
  ).toEqual({ kind: "idle" });
});

test("planRosterAdmission plans an add when the peer is unknown", () => {
  const self = directoryUser({
    userId: "self",
    isSelf: true,
    encapsulationKeyFingerprint: "self-fp",
  });
  const plan = planRosterAdmission({
    directory: directory({ users: [self] }),
    memberGroupId: "member-group",
    members: members([member({ userId: "self" })]),
    userId: "peer",
  });

  expect(plan).toEqual({
    kind: "add-to-member-group",
    memberGroupId: "member-group",
    userId: "peer",
  });
});

test("planRosterAdmission adds a known-but-unseeded peer", () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const peer = directoryUser({
    userId: "peer",
    status: "disabled",
    encapsulationKeyFingerprint: "peer-fp",
  });
  const plan = planRosterAdmission({
    directory: directory({ users: [self, peer] }),
    memberGroupId: "member-group",
    members: members([member({ userId: "self" })]),
    userId: "peer",
  });

  expect(plan.kind).toBe("add-to-member-group");
});

test("planRosterAdmission does not trust the projected admin flag", () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const plan = planRosterAdmission({
    directory: directory({
      currentUser: { isOrgAdmin: false },
      users: [self],
    }),
    memberGroupId: "member-group",
    members: null,
    userId: "peer",
  });

  expect(plan.kind).toBe("add-to-member-group");
  expect(plan).not.toHaveProperty("canAdministerOrganization");
});

test("seedRosterEntry adds the peer to the member group, then retries", async () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const { actions, calls, getAddArgs } = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({
      users: [self],
      memberGroupId: "mg",
    }),
    members: members([member({ userId: "self" })]),
  });

  // Phase 1 issues the membership write but does not settle: the roster entry
  // is not in this directory snapshot yet, so the caller must retry.
  expect(await seedRosterEntry(actions, "peer", { nickname: "Peer 2" })).toBe(
    false,
  );
  expect(calls.addUserToGroup).toBe(1);
  expect(getAddArgs()).toEqual({
    groupId: "mg",
    targetUserId: "peer",
    groupName: "Members",
  });
  expect(calls.ensureRosterProfileDocument).toBe(0);
});

test("seedRosterEntry does not re-add a peer already in the member group", async () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const { actions, calls } = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({
      users: [self],
      memberGroupId: "mg",
    }),
    members: members([member({ userId: "self" }), member({ userId: "peer" })]),
  });

  expect(await seedRosterEntry(actions, "peer", { nickname: "Peer 2" })).toBe(
    false,
  );
  expect(calls.addUserToGroup).toBe(0);
});

test("seedRosterEntry seeds the peer roster nickname once the peer is active", async () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const peer = directoryUser({ userId: "peer", status: "active" });
  const { actions, calls, getEnsureArgs } = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({
      users: [self, peer],
      memberGroupId: "mg",
    }),
    ensuredUser: directoryUser({ userId: "peer", profileDocumentId: "doc-1" }),
  });

  expect(await seedRosterEntry(actions, "peer", { nickname: "Peer 2" })).toBe(
    true,
  );
  expect(calls.ensureRosterProfileDocument).toBe(1);
  expect(getEnsureArgs()).toEqual({ userId: "peer", nickname: "Peer 2" });
});

test("seedRosterEntry retries when the peer roster profile cannot be created yet", async () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const peer = directoryUser({ userId: "peer", status: "active" });
  const { actions, calls } = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({
      users: [self, peer],
      memberGroupId: "mg",
    }),
    ensuredUser: null,
  });

  expect(await seedRosterEntry(actions, "peer", { nickname: "Peer 2" })).toBe(
    false,
  );
  expect(calls.ensureRosterProfileDocument).toBe(1);
});

test("seedRosterEntry is settled once the peer has a profile document", async () => {
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

  expect(await seedRosterEntry(actions, "peer", { nickname: "Peer 2" })).toBe(
    true,
  );
  expect(calls.ensureRosterProfileDocument).toBe(0);
});

test("seedRosterEntry waits when directory, members, or peer import is unavailable", async () => {
  const self = directoryUser({ userId: "self", isSelf: true });
  const noDirectory = fakeRosterSeedActions({ directoryAndGroups: null });
  expect(
    await seedRosterEntry(noDirectory.actions, "peer", { nickname: "Peer 2" }),
  ).toBe(false);

  const noMembers = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({
      users: [self],
      memberGroupId: "mg",
    }),
    members: null,
  });
  expect(
    await seedRosterEntry(noMembers.actions, "peer", { nickname: "Peer 2" }),
  ).toBe(false);
  expect(noMembers.calls.addUserToGroup).toBe(0);
});

function fakeGroupSeedActions(input: {
  groups: OrganizationGroupSummary[];
  memberIds: string[];
  /** False models a read model that has not caught up with a create. */
  surfaceCreatedGroups?: boolean;
}) {
  const { actions } = fakeRosterSeedActions({
    directoryAndGroups: directoryAndGroups({ users: [], memberGroupId: "mg" }),
  });
  const writes: string[] = [];
  const groups = [...input.groups];
  return {
    writes,
    actions: {
      ...actions,
      loadDirectoryAndGroups: async () => ({
        ...directoryAndGroups({ users: [], memberGroupId: "mg" }),
        groups,
      }),
      loadGroupMembers: async (groupId: string) => ({
        ...members(input.memberIds.map((userId) => member({ userId }))),
        groupId,
      }),
      createGroup: async (name: string) => {
        writes.push(`create ${name}`);
        const created = group(`group-${name}`, name);
        if (input.surfaceCreatedGroups !== false) groups.push(created);
        return created;
      },
      addUserToGroup: async (
        groupId: string,
        userId: string,
        groupName: string,
      ) => {
        writes.push(`add ${userId} to ${groupId} (${groupName})`);
        return {};
      },
    },
  };
}

function group(groupId: string, name: string): OrganizationGroupSummary {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    currentState: null,
    groupId,
    isBuiltin: false,
    name,
    nameUnreadable: false,
    organizationId: "org-id",
  };
}

test("the group seed creates a missing group and adds every missing member", async () => {
  const { actions, writes } = fakeGroupSeedActions({
    groups: [],
    memberIds: ["rosa"],
  });
  const seed = createGroupMembersSeed(actions, "Family", ["rosa", "theo"]);
  expect(await seed()).toBe(false);
  expect(writes).toEqual([
    "create Family",
    "add theo to group-Family (Family)",
  ]);
});

test("the group seed reuses the named group and settles once all are members", async () => {
  const { actions, writes } = fakeGroupSeedActions({
    groups: [group("other", "Friends"), group("family", "Family")],
    memberIds: ["rosa", "theo"],
  });
  const seed = createGroupMembersSeed(actions, "Family", ["rosa", "theo"]);
  expect(await seed()).toBe(true);
  expect(writes).toEqual([]);
});

test("a retry before the created group surfaces adds to it, not a second group", async () => {
  const { actions, writes } = fakeGroupSeedActions({
    groups: [],
    memberIds: [],
    surfaceCreatedGroups: false,
  });
  const seed = createGroupMembersSeed(actions, "Family", ["rosa"]);
  expect(await seed()).toBe(false);
  expect(await seed()).toBe(false);
  expect(writes).toEqual([
    "create Family",
    "add rosa to group-Family (Family)",
    "add rosa to group-Family (Family)",
  ]);
});

test("built-in and unreadable groups never match by name", async () => {
  const { actions, writes } = fakeGroupSeedActions({
    groups: [
      { ...group("members", "Family"), isBuiltin: true },
      { ...group("forged", "Family"), nameUnreadable: true },
    ],
    memberIds: [],
  });
  await createGroupMembersSeed(actions, "Family", ["rosa"])();
  expect(writes).toEqual([
    "create Family",
    "add rosa to group-Family (Family)",
  ]);
});
