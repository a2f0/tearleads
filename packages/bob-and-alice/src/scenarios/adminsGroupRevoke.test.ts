import { afterEach, expect, test } from "bun:test";
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
  return { id: admins.groupId, name: admins.name };
}

// A new organization's owner is admin below the root only through the Admins
// group's built-in grant there. Revoking an extra Admins grant on a folder
// rotates that group, rekeys the root under its successor, and revokes the
// folder in one policy commit, so the revoke must cite the successor that
// keeps its signer an admin of the folder.
test("the owner revokes an extra Admins grant on a folder", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const admins = await adminsGroup(world, alice);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "before grant");

  await world.shareWithGroup(alice, folder, admins, "write");
  await world.revoke(alice, folder, admins);

  await world.editDocument(alice, document, "after revoke");
  await world.newDevice(alice);
  await expectAccess(world, document);
  expect(await world.keyEpoch(alice, folder)).toBeGreaterThan(1);
  expectNoSecurityIncidents(world);
}, 180_000);
