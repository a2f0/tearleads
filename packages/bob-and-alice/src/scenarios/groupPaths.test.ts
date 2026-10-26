import { afterEach, expect, test } from "bun:test";
import {
  expectAccess,
  expectNoSecurityIncidents,
} from "../harness/expectations";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

// Bob reaches one folder through two groups, Readers and Editors, and Carol
// only through Readers. Each removal rotates the folder key, yet a member
// keeps access while any group still grants it, and write access through
// Editors lets Bob edit until that group lets him go.
test("a member keeps access while any of its groups still grants it", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const carol = await world.register("carol");
  for (const member of [bob, carol]) {
    await world.addToOrganization(alice, member);
  }

  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "v1 alice");
  const readers = await world.createGroup(alice, "Readers");
  const editors = await world.createGroup(alice, "Editors");
  await world.addToGroup(alice, readers, bob);
  await world.addToGroup(alice, readers, carol);
  await world.addToGroup(alice, editors, bob);
  await world.shareWithGroup(alice, folder, readers, "read");
  await world.shareWithGroup(alice, folder, editors, "write");
  await world.editDocument(bob, document, "v2 bob through Editors");
  await world.editDocument(carol, document, "carol with read access only");
  await world.newDevice(alice);
  await expectAccess(world, document);

  const epochs = [await world.keyEpoch(alice, folder)];
  await world.removeFromGroup(alice, readers, bob);
  epochs.push(await world.keyEpoch(alice, folder));
  await world.editDocument(bob, document, "v3 bob still in Editors");
  await world.newDevice(bob);
  await expectAccess(world, document);

  await world.removeFromGroup(alice, editors, bob);
  epochs.push(await world.keyEpoch(alice, folder));
  await world.editDocument(alice, document, "v4 alice after bob left both");
  await world.editDocument(bob, document, "bob after leaving both groups");
  await world.newDevice(bob);
  await world.newDevice(carol);
  await expectAccess(world, document);

  for (let index = 1; index < epochs.length; index += 1) {
    expect(epochs[index]).toBeGreaterThan(epochs[index - 1] ?? Infinity);
  }
  expectNoSecurityIncidents(world);
}, 300_000);
