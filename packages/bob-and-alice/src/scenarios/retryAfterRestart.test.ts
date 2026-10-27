import { afterEach, expect, test } from "bun:test";
import { readDocument, readText } from "../harness/documentReads";
import {
  expectAccess,
  expectNoSecurityIncidents,
} from "../harness/expectations";
import { documentWrite, type ObservedRequest } from "../harness/transport";
import { until } from "../harness/until";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

function outgoingIds(request: ObservedRequest): string[] {
  const { body } = request;
  if (
    typeof body !== "object" ||
    body === null ||
    !("outgoingUpdates" in body) ||
    !Array.isArray(body.outgoingUpdates)
  ) {
    throw new Error("Expected an outgoing sync request");
  }
  return body.outgoingUpdates.map((update: unknown) => {
    if (
      typeof update !== "object" ||
      update === null ||
      !("id" in update) ||
      typeof update.id !== "string"
    ) {
      throw new Error("Expected a persisted update id");
    }
    return update.id;
  });
}

test("a committed edit with a lost response survives restarting the same database", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "base");
  await world.shareWithUser(alice, folder, bob);
  await expectAccess(world, document);
  const device = bob.devices[0];
  const owner = alice.devices[0];
  if (!device || !owner) throw new Error("Expected original devices");
  const localId = await device.sdk.documents.findLocalIdByDocumentId(
    document.documentId,
  );
  expect(localId).not.toBeNull();
  const store = await readDocument(device, world.documentRef(document));
  if (!store) throw new Error("Expected Bob's document");
  const lost = device.transport.hold(
    "after-response",
    documentWrite(document.documentId),
  );
  await store.setText("one committed edit");
  const committed = await lost.wait();
  expect(committed.status).toBe(200);
  const ids = outgoingIds(committed);
  expect(ids.length).toBeGreaterThan(0);
  device.setOnline(false);
  // Hosts propagate connectivity changes into already-open stores.
  store.updateRuntime(device.sdk.documents.workflowRuntime(folder.id));
  lost.drop();
  await until(() => !store.getSnapshot().syncing, "offline sync stops");
  await device.idle();
  expect(
    (
      await device.sdk.containerContents.documentQueries().listPendingWrites()
    ).some((row) => row.remoteId === document.documentId),
  ).toBe(true);
  expect(await readText(owner, world.documentRef(document))).toBe(
    "one committed edit",
  );
  expect(
    world.model.edit(document.documentId, bob.userId, "one committed edit"),
  ).toBe(true);

  const beforeRestartRequests = device.transport.history.length;
  const restarted = await world.restartDevice(bob, device);
  expect(
    await restarted.sdk.documents.findLocalIdByDocumentId(document.documentId),
  ).toBe(localId);
  // Opening the persisted editor drives the pending update's replay.
  await readDocument(restarted, world.documentRef(document));
  await restarted.idle();
  expect(
    (
      await restarted.sdk.containerContents
        .documentQueries()
        .listPendingWrites()
    ).some((row) => row.remoteId === document.documentId),
  ).toBe(false);
  const retries = restarted.transport.history
    .slice(beforeRestartRequests)
    .filter(documentWrite(document.documentId));
  expect(
    retries.some((request) =>
      ids.every((id) => outgoingIds(request).includes(id)),
    ),
  ).toBe(true);
  await world.newDevice(alice);
  await world.newDevice(bob);
  await expectAccess(world, document);
  expectNoSecurityIncidents(world);
}, 120_000);
