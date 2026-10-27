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

test.each(["membership", "grant"] as const)(
  "the original writer recovers after a %s downgrade and a refused edit",
  async (change) => {
    world = await World.create();
    const alice = await world.register("alice");
    const bob = await world.register("bob");
    await world.addToOrganization(alice, bob);
    const folder = await world.createFolder(alice, world.root(alice), "Shared");
    const document = await world.createDocument(alice, folder, "v1 alice");
    const readers = await world.createGroup(alice, "Readers");
    const editors = await world.createGroup(alice, "Editors");
    await world.addToGroup(alice, readers, bob);
    await world.addToGroup(alice, editors, bob);
    await world.shareWithGroup(alice, folder, readers, "read");
    await world.shareWithGroup(alice, folder, editors, "write");
    await world.editDocument(bob, document, "v2 bob");
    if (change === "membership") {
      await world.removeFromGroup(alice, editors, bob);
    } else {
      await world.shareWithGroup(alice, folder, editors, "read");
    }
    await world.editDocument(alice, document, "v3 after downgrade");
    await expectAccess(world, document);
    await world.editDocument(bob, document, "refused read-only edit");
    await world.newDevice(alice);
    await world.newDevice(bob);
    await expectAccess(world, document);

    if (change === "membership") {
      await world.addToGroup(alice, editors, bob);
    } else {
      await world.shareWithGroup(alice, folder, editors, "write");
    }
    // No fresh database, discarded state, or replacement editor on the actor.
    await world.editDocument(bob, document, "v4 restored writer");
    const original = bob.devices[0];
    if (!original) throw new Error("Expected Bob's original device");
    expect(world.refusedEditsOn(original, document.documentId).size).toBe(0);
    await expectAccess(world, document);
    await world.editDocument(alice, document, "v5 later remote update");
    await expectAccess(world, document);
    // An empty document is content, not evidence that discovery failed.
    await world.editDocument(alice, document, "");
    await expectAccess(world, document);
    expectNoSecurityIncidents(world);
  },
  180_000,
);
