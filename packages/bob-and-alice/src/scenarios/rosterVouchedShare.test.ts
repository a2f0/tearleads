import { afterEach, expect, test } from "bun:test";
import { UnverifiedUserIdentityError } from "@tearleads/client-sdk";
import {
  expectAccess,
  expectNoSecurityIncidents,
} from "../harness/expectations";
import { type Group, type User, World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

async function adminsGroup(current: World, owner: User): Promise<Group> {
  const device = owner.devices[0];
  if (!device) throw new Error(`${owner.name} has no device`);
  const directory = await device.sdk.organizations.loadDirectoryAndGroups();
  const admins = directory?.groups.find(
    (group) => group.isBuiltin && group.name === "Admins",
  );
  if (!admins) throw new Error(`${owner.name} has no Admins group`);
  current.model.addGroup(admins.groupId, [owner.userId]);
  // The Admins group holds the built-in admin grant on the owner's root.
  current.model.grant(
    current.root(owner).id,
    { kind: "group", id: admins.groupId },
    "admin",
  );
  return { id: admins.groupId, name: admins.name };
}

// Alice adds Bob to the roster, makes Carol an admin, and Carol adds Dave.
// Neither of Alice's installs ever verifies Bob's or Dave's own link here.
test("the signed roster admits recipients an admin this device verified added", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const carol = await world.register("carol");
  const dave = await world.register("dave");
  await world.addToOrganization(alice, bob);
  await world.addToOrganization(alice, carol);
  // Alice's first install verifies Carol's link to make her an admin.
  await world.addToGroup(alice, await adminsGroup(world, alice), carol);
  await world.addToOrganization(carol, dave);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "v1");

  const fresh = await world.newDevice(alice);
  await fresh.holdFolder(folder.id);
  const freshTree = await fresh.tree();
  expect(await fresh.sdk.userIdentities.resolveVerified(bob.userId)).toBeNull();
  // Alice signed Bob's addition with her own key, which this install holds.
  expect(await freshTree.shareWithUser(folder.id, bob.userId, "read")).toBe(
    true,
  );
  await fresh.idle();
  world.model.grant(folder.id, { kind: "user", id: bob.userId }, "read");
  // The roster vouches for Bob's encryption key, never his signing key, so it
  // cannot back access whose signed edits this install would accept.
  await expect(
    freshTree.shareWithUser(folder.id, bob.userId, "write"),
  ).rejects.toBeInstanceOf(UnverifiedUserIdentityError);
  // Carol signed Dave's addition, and this install only observed her key.
  await expect(
    freshTree.shareWithUser(folder.id, dave.userId, "read"),
  ).rejects.toBeInstanceOf(UnverifiedUserIdentityError);
  // The vouch admits Bob's encryption key without making his pin a link.
  expect(await fresh.sdk.userIdentities.resolveVerified(bob.userId)).toBeNull();

  // The original install verified Carol's link, so her addition vouches.
  const original = alice.devices[0];
  if (!original) throw new Error("Expected Alice's original device");
  await original.holdFolder(folder.id);
  expect(
    await (await original.tree()).shareWithUser(folder.id, dave.userId, "read"),
  ).toBe(true);
  await original.idle();
  world.model.grant(folder.id, { kind: "user", id: dave.userId }, "read");

  await expectAccess(world, document);
  expectNoSecurityIncidents(world);
}, 300_000);
