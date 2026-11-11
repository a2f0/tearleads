import { afterEach, expect, test } from "bun:test";
import { UnverifiedUserIdentityError } from "@tearleads/client-sdk";
import type { AccessLevel } from "../harness/accessModel";
import type { Device } from "../harness/device";
import {
  expectAccess,
  expectNoSecurityIncidents,
} from "../harness/expectations";
import { type Folder, type Group, type User, World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

function primary(user: User): Device {
  const device = user.devices[0];
  if (!device) throw new Error(`${user.name} has no device`);
  return device;
}

async function adminsGroup(current: World, owner: User): Promise<Group> {
  const directory =
    await primary(owner).sdk.organizations.loadDirectoryAndGroups();
  const admins = directory?.groups.find(
    (group) => group.isBuiltin && group.name === "Admins",
  );
  if (!admins) throw new Error(`${owner.name} has no Admins group`);
  current.model.addGroup(admins.groupId, [owner.userId]);
  current.model.grant(
    current.root(owner).id,
    { kind: "group", id: admins.groupId },
    "admin",
  );
  return { id: admins.groupId, name: admins.name };
}

async function identityChain() {
  const current = await World.create();
  world = current;
  const alice = await current.register("alice");
  const bob = await current.register("bob");
  const carol = await current.register("carol");
  const dave = await current.register("dave");
  // Enrollment uses real identity links on the enrolling device only.
  await current.addToOrganization(alice, bob);
  await current.addToOrganization(alice, carol);
  const admins = await adminsGroup(current, alice);
  await current.addToGroup(alice, admins, carol);
  await current.addToOrganization(carol, dave);
  const team = await current.createGroup(alice, "Team");
  return { current, alice, bob, carol, dave, admins, team };
}

async function expectNoDirectTrust(device: Device, users: readonly User[]) {
  for (const user of users) {
    expect(
      await device.sdk.userIdentities.resolveVerified(user.userId),
    ).toBeNull();
    expect(
      await device.sdk.userIdentities.createLinkFor(
        user.userId,
        "https://app.example.test",
      ),
    ).toBeNull();
  }
}

async function shareFromRoster(
  current: World,
  device: Device,
  folder: Folder,
  recipient: User,
  accessLevel: AccessLevel,
) {
  // Deliberately bypass World's link-admitting share convenience method.
  expect(
    await (await device.tree()).shareWithUser(
      folder.id,
      recipient.userId,
      accessLevel,
    ),
  ).toBe(true);
  await device.idle();
  const info = await device.sdk.containerContents.loadContainerInfo({
    containerId: folder.id,
    remoteInfoMode: "always",
  });
  expect(info.remoteInfo?.grants).toContainEqual({
    subjectType: "user",
    subjectId: recipient.userId,
    accessLevel,
  });
  current.model.grant(
    folder.id,
    { kind: "user", id: recipient.userId },
    accessLevel,
  );
}

async function addFromRoster(
  current: World,
  device: Device,
  group: Group,
  member: User,
) {
  await device.sdk.organizations.addUserToGroup({
    expectedGroupName: group.name,
    groupId: group.id,
    targetUserId: member.userId,
  });
  await device.idle();
  await device.sdk.organizations.loadDirectoryAndGroupsAfterMutation();
  const members = await device.sdk.organizations.loadGroupMembers(group.id);
  expect(members?.members.some((entry) => entry.userId === member.userId)).toBe(
    true,
  );
  current.model.addGroupMember(group.id, member.userId);
}

// A fresh Alice install has only its self anchor. Bob is one signed edge away;
// Dave is reached through Alice -> Carol -> Dave, without importing their links.
test("a fresh self anchor admits direct and transitive roster shares at every permission", async () => {
  const { current, alice, bob, carol, dave, team } = await identityChain();
  const fresh = await current.newDevice(alice);
  expect(
    await fresh.sdk.userIdentities.resolveVerified(alice.userId),
  ).toMatchObject({ userId: alice.userId });
  await expectNoDirectTrust(fresh, [bob, carol, dave]);

  for (const accessLevel of ["read", "write", "admin"] as const) {
    // Exercise each initial grant independently, not permission upgrades.
    const folder = await current.createFolder(
      alice,
      current.root(alice),
      `Shared ${accessLevel}`,
    );
    const document = await current.createDocument(alice, folder, "v1");
    await fresh.holdFolder(folder.id);
    for (const recipient of [bob, dave]) {
      await shareFromRoster(current, fresh, folder, recipient, accessLevel);
    }
    if (accessLevel !== "read") {
      await current.editDocument(bob, document, `Bob ${accessLevel}`);
      await expectAccess(current, document);
      await current.editDocument(dave, document, `Dave ${accessLevel}`);
    }
    await expectAccess(current, document);
  }
  await addFromRoster(current, fresh, team, dave);
  // Admission never promotes an observed pin into a transferable identity link.
  await expectNoDirectTrust(fresh, [bob, carol, dave]);
  expectNoSecurityIncidents(current);
}, 300_000);

test("a departed authentic signer still vouches for a continuously enrolled recipient", async () => {
  const { current, alice, bob, carol, dave, admins, team } =
    await identityChain();
  await current.removeFromGroup(alice, admins, carol);
  const actor = primary(alice);
  const directory = await actor.sdk.organizations.loadDirectoryAndGroups();
  if (!directory) throw new Error("Alice has no directory");
  await actor.sdk.organizations.removeUserFromGroup({
    expectedGroupName: "Members",
    groupId: directory.memberGroupId,
    removedUserId: carol.userId,
  });
  await actor.idle();
  const afterRemoval =
    await actor.sdk.organizations.loadDirectoryAndGroupsAfterMutation();
  expect(
    afterRemoval?.directory.users.find((user) => user.userId === carol.userId)
      ?.status,
  ).toBe("disabled");
  expect(
    afterRemoval?.directory.users.find((user) => user.userId === dave.userId)
      ?.status,
  ).toBe("active");

  const folder = await current.createFolder(
    alice,
    current.root(alice),
    "After Carol left",
  );
  const document = await current.createDocument(
    alice,
    folder,
    "after departure",
  );
  const fresh = await current.newDevice(alice);
  await fresh.holdFolder(folder.id);
  await expectNoDirectTrust(fresh, [bob, carol, dave]);
  await shareFromRoster(current, fresh, folder, dave, "write");
  await addFromRoster(current, fresh, team, dave);
  await current.editDocument(dave, document, "Dave after Carol left");
  await expectAccess(current, document);
  await expectNoDirectTrust(fresh, [bob, carol, dave]);
  expectNoSecurityIncidents(current);
}, 300_000);

test("a roster and admin access cannot replace an independent identity-chain anchor", async () => {
  const { current, alice, bob, carol, dave, admins, team } =
    await identityChain();
  await current.addToGroup(alice, admins, bob);
  const folder = await current.createFolder(
    alice,
    current.root(alice),
    "Anchor required",
  );
  const fresh = await current.newDevice(bob);
  await fresh.holdFolder(folder.id);
  await expectNoDirectTrust(fresh, [alice, carol, dave]);
  const directory = await fresh.sdk.organizations.loadDirectoryAndGroups();
  expect(directory?.directory.currentUser.isOrgAdmin).toBe(true);
  expect(
    directory?.directory.users.find((user) => user.userId === dave.userId)
      ?.status,
  ).toBe("active");
  const tree = await fresh.tree();
  for (const accessLevel of ["read", "write", "admin"] as const) {
    await expect(
      tree.shareWithUser(folder.id, dave.userId, accessLevel),
    ).rejects.toBeInstanceOf(UnverifiedUserIdentityError);
  }
  await expect(
    fresh.sdk.organizations.addUserToGroup({
      expectedGroupName: team.name,
      groupId: team.id,
      targetUserId: dave.userId,
    }),
  ).rejects.toBeInstanceOf(UnverifiedUserIdentityError);
  const members = await fresh.sdk.organizations.loadGroupMembers(team.id);
  expect(members?.members.some((entry) => entry.userId === dave.userId)).toBe(
    false,
  );
  const info = await fresh.sdk.containerContents.loadContainerInfo({
    containerId: folder.id,
    remoteInfoMode: "always",
  });
  expect(
    info.remoteInfo?.grants.some(
      (grant) =>
        grant.subjectType === "user" && grant.subjectId === dave.userId,
    ),
  ).toBe(false);

  // Add precisely the missing anchor. The same selected user now succeeds;
  // no recipient link and no synthetic policy or trust fixture is supplied.
  const aliceLink = await primary(alice).sdk.userIdentities.createLink(
    "https://app.example.test",
  );
  await fresh.sdk.userIdentities.verifyLink(aliceLink);
  await shareFromRoster(current, fresh, folder, dave, "admin");
  await addFromRoster(current, fresh, team, dave);
  await expectNoDirectTrust(fresh, [carol, dave]);
  expectNoSecurityIncidents(current);
}, 300_000);
