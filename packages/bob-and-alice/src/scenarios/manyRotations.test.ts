import { afterEach, expect, test } from "bun:test";
import {
  expectAccess,
  expectNoLeak,
  expectNoSecurityIncidents,
} from "../harness/expectations";
import { trace } from "../harness/trace";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

// A folder whose group gains and loses a member eight times rotates its key
// twice a round. The owner is not one of the group's own admins, so it cannot
// wrap the group's key to a newcomer and mints a new one, and the API re-keys
// every container granted to a group whose key epoch advances. A grantee whose
// device read the document before the first rotation, and read nothing
// since, writes after the last one; a reader admitted at the end reads the
// latest text through the folder key's whole keyring.
test("a writer idle across many rotations writes, and a late reader reads", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const carol = await world.register("carol");
  const dave = await world.register("dave");
  const erin = await world.register("erin");
  for (const member of [bob, carol, dave, erin]) {
    await world.addToOrganization(alice, member);
  }

  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "v0 alice");
  const team = await world.createGroup(alice, "Team");
  await world.addToGroup(alice, team, bob);
  await world.shareWithUser(alice, folder, carol);
  await world.shareWithGroup(alice, folder, team, "write");
  await expectAccess(world, document);

  const rotations = 8;
  const start = await world.keyEpoch(alice, folder);
  const startContent = await world.contentKeyEpoch(alice, document);
  for (let round = 1; round <= rotations; round += 1) {
    await world.addToGroup(alice, team, dave);
    await world.editDocument(dave, document, `v${round} dave in the team`);
    await world.removeFromGroup(alice, team, dave);
    await world.editDocument(bob, document, `v${round} bob after dave left`);
    // Check the removed device before the next admission grants it history.
    // Leave Carol idle so the final stale-writer check still spans every turn.
    const daveDevice = dave.devices[0];
    if (!daveDevice) throw new Error("Expected Dave's original device");
    await expectNoLeak(world, document, daveDevice);
  }
  const end = await world.keyEpoch(alice, folder);
  const endContent = await world.contentKeyEpoch(alice, document);
  trace(`folder ${start} -> ${end}, content ${startContent} -> ${endContent}`);
  expect(end).toBe(start + 2 * rotations);
  expect(endContent).toBeGreaterThanOrEqual(startContent + rotations);

  await world.editDocument(carol, document, "carol after many rotations");
  await world.shareWithUser(alice, folder, erin);
  for (const user of [alice, bob, carol, dave]) await world.newDevice(user);
  await expectAccess(world, document);
  expectNoSecurityIncidents(world);
}, 600_000);
