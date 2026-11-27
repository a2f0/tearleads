import { afterEach, expect, test } from "bun:test";
import type { Device } from "../harness/device";
import { readDocument, readText } from "../harness/documentReads";
import {
  expectAccess,
  expectNoSecurityIncidents,
} from "../harness/expectations";
import { until } from "../harness/until";
import { type SharedDocument, World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

async function heldSummary(device: Device, document: SharedDocument) {
  const localId = await device.sdk.documents.findLocalIdByDocumentId(
    document.documentId,
  );
  const note = (await device.sdk.documents.list())?.rows.find(
    (row) => row.id === localId,
  );
  if (!note) throw device.failure("does not hold the document");
  return note;
}

async function hasPendingWrite(
  device: Device,
  documentId: string,
): Promise<boolean> {
  const pending = await device.sdk.containerContents
    .documentQueries()
    .listPendingWrites();
  return pending.some((item) => item.remoteId === documentId);
}

// Remote deletion requires a verified signed purge proof: when Alice purges a
// shared document, Bob's sync sees coded `404 document_not_found`, fetches and
// verifies `GET /documents/:id/purge`, and atomically destroys his local copy
// and queued offline edit. A bare 404 without a purge code never destroys
// local data or pending edits.
test("a signed document purge destroys a peer's copy and queued edit, while a bare 404 retains local data", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const doomed = await world.createDocument(alice, folder, "doomed v1");
  const kept = await world.createDocument(alice, folder, "kept v1");
  await world.shareWithUser(alice, folder, bob);
  const aliceDevice = alice.devices[0];
  const bobDevice = bob.devices[0];
  if (!aliceDevice || !bobDevice) throw new Error("Expected original devices");

  const bobDoomed = await readDocument(bobDevice, world.documentRef(doomed));
  const bobKept = await readDocument(bobDevice, world.documentRef(kept));
  if (!bobDoomed || !bobKept) throw bobDevice.failure("cannot open documents");
  expect(bobDoomed.getSnapshot().text).toBe("doomed v1");
  expect(bobKept.getSnapshot().text).toBe("kept v1");

  // Bob queues offline edits on both documents before Alice purges one.
  bobDevice.setOnline(false);
  bobDoomed.updateRuntime(bobDevice.sdk.documents.workflowRuntime(folder.id));
  bobKept.updateRuntime(bobDevice.sdk.documents.workflowRuntime(folder.id));
  await bobDoomed.setText("bob offline on doomed");
  await bobKept.setText("bob offline on kept");
  expect(await hasPendingWrite(bobDevice, doomed.documentId)).toBe(true);
  expect(await hasPendingWrite(bobDevice, kept.documentId)).toBe(true);

  const doomedNote = await heldSummary(aliceDevice, doomed);
  const purged = await aliceDevice.sdk.containerContents
    .documentLinks()
    .purgeDocument({ note: doomedNote });
  expect(purged).not.toBeNull();
  await aliceDevice.idle();
  expect(
    await aliceDevice.sdk.documents.findLocalIdByDocumentId(doomed.documentId),
  ).toBeNull();

  // Play a broken or dishonest server returning a bare 404 on `kept`.
  let injectBare404 = true;
  bobDevice.transport.overrideResponses(
    (request) =>
      request.path === `/documents/${kept.documentId}/sync` ||
      request.path === `/documents/${kept.documentId}/writer-projection`,
    () =>
      injectBare404
        ? Response.json({ error: "Not found" }, { status: 404 })
        : null,
  );

  const beforeReconnect = bobDevice.transport.history.length;
  bobDevice.setOnline(true);
  bobDoomed.updateRuntime(bobDevice.sdk.documents.workflowRuntime(folder.id));
  bobKept.updateRuntime(bobDevice.sdk.documents.workflowRuntime(folder.id));
  await bobDoomed
    .requestRemoteSyncAndWait(new AbortController().signal)
    .catch(() => false);
  await bobKept
    .requestRemoteSyncAndWait(new AbortController().signal)
    .catch(() => false);
  await bobDevice.idle();

  // `doomed` verified its signed purge proof and tore down locally.
  const exchanges = bobDevice.transport.history.slice(beforeReconnect);
  expect(
    exchanges.some(
      ({ method, path, status }) =>
        method === "GET" &&
        path === `/documents/${doomed.documentId}/purge` &&
        status === 200,
    ),
  ).toBe(true);
  await until(
    async () =>
      (await bobDevice.sdk.documents.findLocalIdByDocumentId(
        doomed.documentId,
      )) === null,
    "Bob's purged document to tear down",
  );
  expect(await hasPendingWrite(bobDevice, doomed.documentId)).toBe(false);

  // `kept` received bare 404s and preserved both local content and queue.
  expect(
    exchanges.some(
      ({ path, status, errorCode }) =>
        path.includes(`/documents/${kept.documentId}/`) &&
        status === 404 &&
        errorCode === undefined,
    ),
  ).toBe(true);
  expect(
    await bobDevice.sdk.documents.findLocalIdByDocumentId(kept.documentId),
  ).not.toBeNull();
  expect(bobKept.getSnapshot().text).toBe("bob offline on kept");
  expect(await hasPendingWrite(bobDevice, kept.documentId)).toBe(true);

  // Once the server answers honestly again, Bob's queued edit on `kept` lands.
  injectBare404 = false;
  await bobKept.requestRemoteSyncAndWait(new AbortController().signal);
  await bobDevice.idle();
  expect(await hasPendingWrite(bobDevice, kept.documentId)).toBe(false);
  expect(
    world.model.edit(kept.documentId, bob.userId, "bob offline on kept"),
  ).toBe(true);
  await expectAccess(world, kept);
  expectNoSecurityIncidents(world);
}, 240_000);

// A purge POST that commits on the API before its response is lost leaves the
// local document intact until the next sync sees coded `404 document_not_found`
// and verifies the signed purge proof.
test("a lost purge response completes local teardown from the signed purge proof after restart", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const folder = await world.createFolder(alice, world.root(alice), "Private");
  const document = await world.createDocument(alice, folder, "secret to purge");
  const device = alice.devices[0];
  if (!device) throw new Error("Expected Alice's device");

  const note = await heldSummary(device, document);
  const lost = device.transport.hold(
    "after-response",
    ({ method, path }) =>
      method === "POST" && path === `/documents/${document.documentId}/purge`,
  );
  const purging = device.sdk.containerContents
    .documentLinks()
    .purgeDocument({ note });
  const committed = await lost.wait();
  expect(committed.status).toBe(200);
  lost.drop();
  expect(await purging).toBeNull();
  // Without an acknowledged proof, the local record is still retained.
  expect(
    await device.sdk.documents.findLocalIdByDocumentId(document.documentId),
  ).not.toBeNull();

  // After a restart, syncing the document fetches the signed purge proof and
  // tears down the local record cleanly.
  const restarted = await world.restartDevice(alice, device);
  const before = restarted.transport.history.length;
  await readDocument(restarted, world.documentRef(document));
  await restarted.idle();
  await until(
    async () =>
      (await restarted.sdk.documents.findLocalIdByDocumentId(
        document.documentId,
      )) === null,
    "restarted device to complete lost-response purge",
  );
  expect(
    restarted.transport.history
      .slice(before)
      .some(
        ({ method, path, status }) =>
          method === "GET" &&
          path === `/documents/${document.documentId}/purge` &&
          status === 200,
      ),
  ).toBe(true);
  expectNoSecurityIncidents(world);
}, 180_000);

// Recursively purging one folder of a multi-link document unlinks only the
// purged subtree while keeping the document alive and readable through its
// surviving link — whether the document was created in the purged folder
// (primary link) or linked into it from the surviving folder (secondary link).
for (const origin of ["purged-folder", "surviving-folder"] as const) {
  test(`purging one folder of a multi-link document preserves the surviving link (${origin})`, async () => {
    world = await World.create();
    const alice = await world.register("alice");
    const bob = await world.register("bob");
    const carol = await world.register("carol");
    await world.addToOrganization(alice, bob);
    await world.addToOrganization(alice, carol);
    const team = await world.createFolder(alice, world.root(alice), "Team");
    const handoff = await world.createFolder(
      alice,
      world.root(alice),
      "Handoff",
    );
    const document =
      origin === "purged-folder"
        ? await world.createDocument(alice, handoff, "linked v1")
        : await world.createDocument(alice, team, "linked v1");
    await world.shareWithUser(alice, team, bob);
    await world.shareWithUser(alice, handoff, carol);
    await world.linkDocument(
      alice,
      document,
      origin === "purged-folder" ? team : handoff,
    );
    await expectAccess(world, document);

    const aliceDevice = alice.devices[0];
    if (!aliceDevice) throw new Error("Expected Alice's device");
    const tree = await aliceDevice.tree();
    expect(await tree.purgeContainer(handoff.id)).toBe(true);
    await aliceDevice.idle();
    world.model.unlinkDocument(document.documentId, handoff.id);

    await world.editDocument(alice, document, "linked v2 after handoff purged");
    await world.newDevice(bob);
    await world.newDevice(carol);
    await expectAccess(world, document);

    // Carol's original device lost access through the purged folder and cannot
    // read the post-purge edit, while Bob can still write through Team.
    await world.editDocument(bob, document, "linked v3 bob through team");
    expect(await readText(aliceDevice, world.documentRef(document))).toBe(
      "linked v3 bob through team",
    );
    await expectAccess(world, document);
    expectNoSecurityIncidents(world);
  }, 240_000);
}
