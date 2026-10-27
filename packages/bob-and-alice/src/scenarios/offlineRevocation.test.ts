import { afterEach, expect, test } from "bun:test";
import { readDocument, readText } from "../harness/documentReads";
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

test("an offline outbox survives restart, refuses revoked writes, and recovers after regrant", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "v1");
  await world.shareWithUser(alice, folder, bob);
  await expectAccess(world, document);
  const device = bob.devices[0];
  if (!device) throw new Error("Expected Bob's original device");
  const store = await readDocument(device, world.documentRef(document));
  if (!store) throw new Error("Expected Bob's held editor");
  device.setOnline(false);
  // Hosts propagate connectivity changes into already-open stores.
  store.updateRuntime(device.sdk.documents.workflowRuntime(folder.id));
  await store.setText("offline edit before revocation");
  expect(
    (
      await device.sdk.containerContents.documentQueries().listPendingWrites()
    ).some((row) => row.remoteId === document.documentId),
  ).toBe(true);
  await world.revoke(alice, folder, bob);
  await world.editDocument(alice, document, "v2 after revocation");

  const restarted = await world.restartDevice(bob, device, false);
  expect(
    (
      await restarted.sdk.containerContents
        .documentQueries()
        .listPendingWrites()
    ).some((row) => row.remoteId === document.documentId),
  ).toBe(true);
  restarted.setOnline(true);
  await restarted.idle();
  const held = await readText(restarted, world.documentRef(document));
  expect([null, "", "v1", "offline edit before revocation"]).toContain(held);
  const freshOwner = await world.newDevice(alice);
  expect(await readText(freshOwner, world.documentRef(document))).toBe(
    "v2 after revocation",
  );
  await world.shareWithUser(alice, folder, bob);
  await world.editDocument(bob, document, "v3 after restored access");
  await world.newDevice(bob);
  await expectAccess(world, document);
  expectNoSecurityIncidents(world);
}, 120_000);
