import { afterEach, expect, test } from "bun:test";
import {
  encodeVersionVectorCounters,
  mergeVersionVectors,
} from "@tearleads/loro";
import type { Device } from "../harness/device";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

async function folderName(device: Device, folderId: string) {
  const tree = await device.tree();
  await tree.refresh();
  await device.idle();
  return tree.getSnapshot().nodes.find((node) => node.id === folderId)?.name;
}

// A folder's metadata holds a rename whose declared span claims operations
// no version holds. A rotation baseline must cover every committed update it
// does not stand past, so before metadata kept a processed cursor, that one
// rename refused every rotation baseline of the folder's metadata, and no
// device could rename the folder after its key rotated. A reader that voided
// the rename signs its processed cursor into the baseline, and the API weighs
// only the updates after it.
test("a folder whose metadata holds a false-span rename still rotates", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const carol = await world.register("carol");
  await world.addToOrganization(alice, bob);
  await world.addToOrganization(alice, carol);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  await world.shareWithUser(alice, folder, bob);
  await world.shareWithUser(alice, folder, carol);
  const reader = bob.devices[0];
  const offline = carol.devices[0];
  if (!reader || !offline)
    throw new Error("Expected Bob's and Carol's devices");
  await reader.holdFolder(folder.id);
  await offline.holdFolder(folder.id);

  offline.setOnline(false);
  expect(
    await (await offline.tree()).renameContainer(folder.id, "Forged"),
  ).not.toBeNull();
  const liar = await world.restartDevice(carol, offline, false);
  expect(
    await liar.forgeQueuedUpdateSpans(
      ({ end, start }) => ({
        end: mergeVersionVectors([
          end,
          encodeVersionVectorCounters({ "4242": 7 }),
        ]),
        start,
      }),
      "container-metadata",
    ),
  ).toBe(1);
  liar.setOnline(true);
  await (await liar.tree()).refresh();
  await liar.idle();
  expect(await folderName(reader, folder.id)).toBe("Shared");

  // Removing the liar rotates the folder's key, so the next rename of the
  // folder re-encrypts its metadata from a rotation baseline.
  await world.revoke(alice, folder, carol);
  expect(
    await (await reader.tree()).renameContainer(folder.id, "Bob's name"),
  ).not.toBeNull();
  await reader.idle();

  const fresh = await world.newDevice(alice);
  await fresh.holdFolder(folder.id);
  expect(await folderName(fresh, folder.id)).toBe("Bob's name");
  expectNoSecurityIncidents(world);
}, 240_000);
