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

const VOIDED = "Documents: sync update voided";

function voidReports(device: Device) {
  return device.errors.filter(({ message }) => message === VOIDED).length;
}

async function folderName(device: Device, folderId: string) {
  const tree = await device.tree();
  await tree.refresh();
  await device.idle();
  return tree.getSnapshot().nodes.find((node) => node.id === folderId)?.name;
}

// Folder metadata documents void a false-span update as document content
// does: the reader keeps the folder's earlier name, reports the update once
// although metadata keeps no processed cursor and judges it on every pull,
// and its own renames still settle and reach the writer.
test("a reader voids a false-span folder rename and keeps syncing the folder", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  await world.shareWithUser(alice, folder, bob);
  const reader = bob.devices[0];
  if (!reader) throw new Error("Expected Bob's device");
  await reader.holdFolder(folder.id);
  expect(await folderName(reader, folder.id)).toBe("Shared");

  const offline = alice.devices[0];
  if (!offline) throw new Error("Expected Alice's device");
  offline.setOnline(false);
  expect(
    await (await offline.tree()).renameContainer(folder.id, "Forged"),
  ).not.toBeNull();
  const liar = await world.restartDevice(alice, offline, false);
  const forged = await liar.forgeQueuedUpdateSpans(
    ({ end, start }) => ({
      end: mergeVersionVectors([
        end,
        encodeVersionVectorCounters({ "4242": 7 }),
      ]),
      start,
    }),
    "container-metadata",
  );
  expect(forged).toBe(1);
  liar.setOnline(true);
  await (await liar.tree()).refresh();
  await liar.idle();

  for (let pass = 0; pass < 3; pass += 1) {
    expect(await folderName(reader, folder.id)).toBe("Shared");
  }
  expect(voidReports(reader)).toBe(1);

  // Bob never holds the forged rename, so his first rename can tie it on
  // Alice's device; his second is later than both.
  const readerTree = await reader.tree();
  for (const name of ["Bob's draft", "Bob's name"]) {
    expect(await readerTree.renameContainer(folder.id, name)).not.toBeNull();
    await reader.idle();
  }
  expect(await folderName(liar, folder.id)).toBe("Bob's name");
  expect(voidReports(reader)).toBe(1);
  expectNoSecurityIncidents(world);
}, 180_000);
