import { afterEach, expect, test } from "bun:test";
import type { Device } from "../harness/device";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { until } from "../harness/until";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

/** Waits until the device is idle and stops making HTTP requests for `quietMs`. */
async function settleQuiet(device: Device, quietMs = 200): Promise<void> {
  await device.idle();
  let lastCount = device.transport.history.length;
  let quietSince = Date.now();
  await until(async () => {
    await device.idle();
    const count = device.transport.history.length;
    if (count !== lastCount) {
      lastCount = count;
      quietSince = Date.now();
      return false;
    }
    return Date.now() - quietSince >= quietMs;
  }, `${device.label} quiet window`);
}

/** Opens device-first over an existing database and acknowledges realtime. */
async function startAcknowledgedDeviceFirst(device: Device) {
  const handle = await device.openDeviceFirst();
  device.sdk.events.setConnected(true);
  handle.view.updateRuntime(device.sdk.containerContents.workflowRuntime());
  return handle;
}

async function localDocumentText(
  device: Device,
  documentId: string,
): Promise<string | null> {
  const localId =
    await device.sdk.documents.findLocalIdByDocumentId(documentId);
  if (!localId) return null;
  const store = device.sdk.documents.open(
    { documentId, localId },
    { createIfMissing: false, remoteSyncMode: "on-demand" },
  );
  if (!(await store.ensureInitialized())) return null;
  return store.getSnapshot().text;
}

// Mirrors `packages/performance`'s document reload probe in a multi-party
// setting: once a device has settled its shared folders, an acknowledged reload
// with nothing changed re-syncs zero notes and reads zero document projections.
// After another member edits a note in one folder, the next reload lists only
// the moved folder and pulls only the edited note.
test("a settled reload skips untouched notes and catches up only the note a peer edited", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);

  const quietFolder = await world.createFolder(
    alice,
    world.root(alice),
    "Quiet",
  );
  const activeFolder = await world.createFolder(
    alice,
    world.root(alice),
    "Active",
  );
  const quietDoc = await world.createDocument(alice, quietFolder, "quiet v1");
  const activeDoc = await world.createDocument(
    alice,
    activeFolder,
    "active v1",
  );
  await world.shareWithUser(alice, quietFolder, bob);
  await world.shareWithUser(alice, activeFolder, bob);

  const initialBob = bob.devices[0];
  if (!initialBob) throw new Error("Expected Bob's original device");
  let bobDevice: Device = initialBob;

  // First boot discovers both shared folders and hydrates both notes.
  await startAcknowledgedDeviceFirst(bobDevice);
  await until(
    async () =>
      (await localDocumentText(bobDevice, quietDoc.documentId)) ===
        "quiet v1" &&
      (await localDocumentText(bobDevice, activeDoc.documentId)) ===
        "active v1",
    "Bob's initial device-first hydration",
  );
  await settleQuiet(bobDevice);

  // One warmup reload settles every lane watermark left by the initial boot.
  bobDevice = await world.reloadDevice(bob, bobDevice);
  await startAcknowledgedDeviceFirst(bobDevice);
  await settleQuiet(bobDevice);

  // Settled reload: nothing changed remotely, so neither note syncs or reads
  // its writer projection.
  bobDevice = await world.reloadDevice(bob, bobDevice);
  const settledFrom = bobDevice.transport.history.length;
  await startAcknowledgedDeviceFirst(bobDevice);
  await settleQuiet(bobDevice);
  const settledTraffic = bobDevice.transport.history.slice(settledFrom);
  for (const docId of [quietDoc.documentId, activeDoc.documentId]) {
    expect(
      settledTraffic.filter(
        ({ method, path }) =>
          method === "POST" && path === `/documents/${docId}/sync`,
      ),
    ).toEqual([]);
    expect(
      settledTraffic.filter(
        ({ method, path }) =>
          method === "GET" && path === `/documents/${docId}/writer-projection`,
      ),
    ).toEqual([]);
  }

  // Alice edits only the note in Active while Bob reloads.
  await world.editDocument(alice, activeDoc, "active v2 from alice");
  bobDevice = await world.reloadDevice(bob, bobDevice);
  const peerEditFrom = bobDevice.transport.history.length;
  await startAcknowledgedDeviceFirst(bobDevice);
  await until(
    async () =>
      (await localDocumentText(bobDevice, activeDoc.documentId)) ===
      "active v2 from alice",
    "Bob's reload catch-up to pull Alice's edit",
  );
  await settleQuiet(bobDevice);

  const peerEditTraffic = bobDevice.transport.history.slice(peerEditFrom);
  expect(
    peerEditTraffic.some(
      ({ method, path, status }) =>
        method === "POST" &&
        path === `/documents/${activeDoc.documentId}/sync` &&
        status === 200,
    ),
  ).toBe(true);
  expect(
    peerEditTraffic.filter(
      ({ method, path }) =>
        method === "POST" && path === `/documents/${quietDoc.documentId}/sync`,
    ),
  ).toEqual([]);
  expect(await localDocumentText(bobDevice, quietDoc.documentId)).toBe(
    "quiet v1",
  );
  expectNoSecurityIncidents(world);
}, 240_000);

// Issue #3255: when a fresh install discovers a shared folder in its tree but
// reloads before that folder's document lane ever settles, the lane stays
// durably owed. Reloading without an acknowledged realtime connection still
// lists the owed lane and hydrates the peer's document.
test("a cut-short boot leaves an owed shared folder lane that converges after reload without realtime", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const doc = await world.createDocument(alice, folder, "from alice");
  await world.shareWithUser(alice, folder, bob);

  const fresh = await world.newDevice(bob);
  let blockDocumentListings = true;
  fresh.transport.overrideResponses(
    ({ method, path }) =>
      method === "POST" && path === "/containers/documents/query",
    () =>
      blockDocumentListings
        ? new Response("Cut short before document listing", { status: 503 })
        : null,
  );
  // The tree holds the shared folder, but its document lane is cut short with
  // 503 before applying any documents.
  await fresh.openDeviceFirst();
  await fresh.holdFolder(folder.id);
  await until(
    () =>
      fresh.transport.history.some(
        ({ method, path, status }) =>
          method === "POST" &&
          path === "/containers/documents/query" &&
          status === 503,
      ),
    "fresh boot to hit blocked document listing",
  );
  await fresh.idle();
  expect(
    await fresh.sdk.documents.findLocalIdByDocumentId(doc.documentId),
  ).toBeNull();

  // Reload with no realtime acknowledgement: owed-lane resumption lists the
  // unfinished folder and hydrates Alice's document.
  blockDocumentListings = false;
  const reloaded = await world.reloadDevice(bob, fresh);
  await reloaded.openDeviceFirst();
  await until(
    async () =>
      (await localDocumentText(reloaded, doc.documentId)) === "from alice",
    "owed shared lane to hydrate after reload without realtime",
  );
  await settleQuiet(reloaded);
  expectNoSecurityIncidents(world);
}, 240_000);

// Issue #3291: once a shared folder's document lane has settled, starting
// without an acknowledged realtime connection crawls the tree from its
// watermark so a settled folder whose server row moved owes a listing,
// discovering peer additions and edits while leaving untouched folders quiet.
test("#3291: a settled shared folder discovers a peer's new document without an acknowledged connection", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const seed = await world.createDocument(alice, folder, "seed");
  await world.shareWithUser(alice, folder, bob);

  const initialBob = bob.devices[0];
  if (!initialBob) throw new Error("Expected Bob's device");
  let bobDevice: Device = initialBob;
  await startAcknowledgedDeviceFirst(bobDevice);
  await until(
    async () =>
      (await localDocumentText(bobDevice, seed.documentId)) === "seed",
    "Bob to settle the shared folder",
  );
  await settleQuiet(bobDevice);

  // Alice adds a new document while Bob restarts without realtime.
  const lateDoc = await world.createDocument(alice, folder, "added offline");
  bobDevice = await world.reloadDevice(bob, bobDevice);
  const attempt = bobDevice.sdk.events.beginConnectAttempt();
  const handle = await bobDevice.openDeviceFirst();
  // The connect attempt ends without an interest acknowledgement.
  bobDevice.sdk.events.endConnectAttempt(attempt);
  handle.view.updateRuntime(bobDevice.sdk.containerContents.workflowRuntime());
  await until(
    async () =>
      (await localDocumentText(bobDevice, lateDoc.documentId)) ===
      "added offline",
    "settled shared folder to discover Alice's new document without realtime",
  );
  await settleQuiet(bobDevice, 400);

  expect(
    await bobDevice.sdk.documents.findLocalIdByDocumentId(lateDoc.documentId),
  ).not.toBeNull();
  expectNoSecurityIncidents(world);
}, 180_000);

test("#3291: a quiet settled folder sends no document listing on an unacknowledged restart, and pulls a peer edit", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const doc = await world.createDocument(alice, folder, "v1");
  await world.shareWithUser(alice, folder, bob);

  const initialBob = bob.devices[0];
  if (!initialBob) throw new Error("Expected Bob's device");
  let bobDevice: Device = initialBob;
  await startAcknowledgedDeviceFirst(bobDevice);
  await until(
    async () => (await localDocumentText(bobDevice, doc.documentId)) === "v1",
    "Bob to hydrate initial shared document",
  );
  await settleQuiet(bobDevice);

  // One warmup reload settles every lane watermark left by the initial boot.
  bobDevice = await world.reloadDevice(bob, bobDevice);
  await startAcknowledgedDeviceFirst(bobDevice);
  await settleQuiet(bobDevice);

  // Quiet unacknowledged restart: watermarked tree crawl vouches for every
  // settled folder, so zero document-lane queries or note syncs are sent.
  bobDevice = await world.reloadDevice(bob, bobDevice);
  const quietFrom = bobDevice.transport.history.length;
  const quietHandle = await bobDevice.openDeviceFirst();
  await settleQuiet(bobDevice, 400);
  const quietTraffic = bobDevice.transport.history.slice(quietFrom);
  expect(
    quietTraffic.filter(
      ({ method, path }) =>
        method === "POST" &&
        (path === "/containers/documents/query" ||
          path === `/documents/${doc.documentId}/sync`),
    ),
  ).toEqual([]);
  expect(quietHandle.view.getSnapshot().ready).toBe(true);

  // Alice edits the already-settled document while Bob restarts unacknowledged.
  await world.editDocument(alice, doc, "v2");
  bobDevice = await world.reloadDevice(bob, bobDevice);
  await bobDevice.openDeviceFirst();
  await until(
    async () => (await localDocumentText(bobDevice, doc.documentId)) === "v2",
    "Bob to pull peer edit to settled document without realtime",
  );
  await settleQuiet(bobDevice, 400);
  expectNoSecurityIncidents(world);
}, 180_000);
