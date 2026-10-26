import { afterEach, test } from "bun:test";
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

// One document in two folders shared to different principals. Either link
// grants reading, write through one link reaches every reader, a shrink on
// one link's group leaves the other link's readers alone, and an unlink
// takes that link's readers away.
test("a document linked into two folders follows each link's access", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const carol = await world.register("carol");
  const erin = await world.register("erin");
  for (const member of [bob, carol, erin]) {
    await world.addToOrganization(alice, member);
  }

  const team = await world.createFolder(alice, world.root(alice), "Team space");
  const handoff = await world.createFolder(alice, world.root(alice), "Handoff");
  const document = await world.createDocument(alice, team, "v1 alice");
  const readers = await world.createGroup(alice, "Readers");
  await world.addToGroup(alice, readers, bob);
  await world.addToGroup(alice, readers, carol);
  await world.shareWithGroup(alice, team, readers, "read");
  await world.shareWithUser(alice, handoff, erin);
  await world.linkDocument(alice, document, handoff);
  await expectAccess(world, document);

  // Erin writes through her link; readers through the other one see it,
  // and a read-only reader's edit never lands.
  await world.editDocument(erin, document, "v2 erin through the handoff");
  await world.editDocument(bob, document, "bob without write access");
  await expectAccess(world, document);

  await world.removeFromGroup(alice, readers, bob);
  await world.editDocument(alice, document, "v3 alice after bob left");
  await world.newDevice(erin);
  await world.newDevice(bob);
  await expectAccess(world, document);

  await world.unlinkDocument(alice, document, handoff);
  await world.editDocument(alice, document, "v4 alice after the unlink");
  await world.newDevice(erin);
  await expectAccess(world, document);
  expectNoSecurityIncidents(world);
}, 300_000);
