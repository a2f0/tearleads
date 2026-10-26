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

test("a direct grant keeps access after the overlapping group grant goes", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);

  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(
    alice,
    folder,
    "v1 before any share",
  );
  const team = await world.createGroup(alice, "Team");
  await world.addToGroup(alice, team, bob);
  await world.shareWithGroup(alice, folder, team, "read");
  await world.shareWithUser(alice, folder, bob);
  await expectAccess(world, document);

  const epochBefore = await world.keyEpoch(alice, folder);
  await world.removeFromGroup(alice, team, bob);
  expect(await world.keyEpoch(alice, folder)).toBeGreaterThan(epochBefore);
  await world.editDocument(alice, document, "v2 after bob left the group");
  await world.newDevice(bob);
  await expectAccess(world, document);

  await world.revoke(alice, folder, bob);
  await world.editDocument(
    alice,
    document,
    "v3 after bob lost the direct grant",
  );
  await world.newDevice(bob);
  await expectAccess(world, document);
  expectNoSecurityIncidents(world);
}, 180_000);
