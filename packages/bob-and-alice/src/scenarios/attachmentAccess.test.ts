import { afterEach, expect, test } from "bun:test";
import {
  type DocumentStore,
  getDomainDownloadHistorySnapshot,
} from "@tearleads/client-sdk";
import type { Device } from "../harness/device";
import { readDocument, readText } from "../harness/documentReads";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { until } from "../harness/until";
import { type SharedDocument, World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text));
}

function decodeUtf8(bytes: Uint8Array | null): string | null {
  return bytes ? new TextDecoder().decode(bytes) : null;
}

async function listServerAttachmentSlotIds(
  device: Device,
  documentId: string,
): Promise<string[]> {
  const bindings = await device.sdk.documents
    .workflowRuntime()
    .apiClient.listDocumentAttachments(documentId, { refresh: true });
  return (bindings ?? []).map(({ slotId }) => slotId);
}

/** Pulls `document` on `device` until `name` hydrates locally and returns its UTF-8 text. */
async function readAttachmentText(
  device: Device,
  worldRef: World,
  document: SharedDocument,
  name: string,
): Promise<string> {
  const store = await readDocument(device, worldRef.documentRef(document));
  if (!store) throw device.failure("cannot open the document");
  let storageKey: string | undefined;
  await until(async () => {
    const snapshot = store.getSnapshot();
    const slot = snapshot.attachments.find((item) => item.name === name);
    storageKey = slot
      ? snapshot.attachmentStorageKeyBySlotId[slot.slotId]
      : undefined;
    if (storageKey) return true;
    await store
      .requestRemoteSyncAndWait(new AbortController().signal)
      .catch(() => false);
    return false;
  }, `${device.label} attachment ${name} to hydrate`);
  if (!storageKey) throw device.failure(`missing storage key for ${name}`);
  const text = decodeUtf8(await device.sdk.blobs.store.readBytes(storageKey));
  if (text === null) throw device.failure(`missing bytes for ${name}`);
  return text;
}

/** Attaches one UTF-8 file to `store` and waits until the API holds its binding. */
async function attachAndBind(
  device: Device,
  store: DocumentStore,
  documentId: string,
  name: string,
  content: string,
): Promise<string> {
  store.attachFiles([
    {
      bytes: bytesOf(content),
      mimeType: "text/plain",
      name,
    },
  ]);
  let slotId: string | undefined;
  await until(() => {
    slotId = store
      .getSnapshot()
      .attachments.find((item) => item.name === name)?.slotId;
    return slotId !== undefined;
  }, `${device.label} attachment slot ${name}`);
  if (!slotId) throw device.failure(`missing slot for ${name}`);
  const boundSlotId = slotId;
  await until(
    async () =>
      (await listServerAttachmentSlotIds(device, documentId)).includes(
        boundSlotId,
      ),
    `${device.label} binding for ${name}`,
  );
  await device.idle();
  expect(store.getSnapshot().attachmentStatusBySlotId[boundSlotId]).toBe(
    undefined,
  );
  return boundSlotId;
}

// Attachments ride on the document's content key. A current reader downloads
// and decrypts exact bytes and records the download; revoking a member rotates
// the content key on the next write, so a newly attached file is unreadable to
// the revoked member (original or fresh device) while remaining members and
// fresh installs decrypt both historical and post-revocation attachments via
// the folder keyring. Removing an attachment detaches it for every reader.
test("attachments decrypt across devices, stay confidential after revocation, and propagate removal", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  const carol = await world.register("carol");
  await world.addToOrganization(alice, bob);
  await world.addToOrganization(alice, carol);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "v1");
  await world.shareWithUser(alice, folder, bob);
  await world.shareWithUser(alice, folder, carol);
  const aliceDevice = alice.devices[0];
  const bobDevice = bob.devices[0];
  const carolDevice = carol.devices[0];
  if (!aliceDevice || !bobDevice || !carolDevice) {
    throw new Error("Expected original devices");
  }

  const aliceStore = await readDocument(
    aliceDevice,
    world.documentRef(document),
  );
  if (!aliceStore) throw aliceDevice.failure("cannot open document");
  const beforeSlotId = await attachAndBind(
    aliceDevice,
    aliceStore,
    document.documentId,
    "before.txt",
    "before-revocation-secret",
  );

  // Bob downloads and decrypts the attachment and records it in download history.
  expect(
    await readAttachmentText(bobDevice, world, document, "before.txt"),
  ).toBe("before-revocation-secret");
  expect(
    getDomainDownloadHistorySnapshot(
      bobDevice.sdk.runtime.input().state.domainScope,
    ).completed,
  ).toContainEqual(
    expect.objectContaining({
      documentId: document.documentId,
      fileName: "before.txt",
      objectKind: "attachment",
    }),
  );

  // Revoking Bob rotates the folder key; Alice's next edit and attachment move
  // the document onto a fresh content key that Bob never receives.
  const contentEpochBefore = await world.contentKeyEpoch(alice, document);
  await world.revoke(alice, folder, bob);
  await world.editDocument(alice, document, "v2 after bob revoked");
  expect(await world.contentKeyEpoch(alice, document)).toBeGreaterThan(
    contentEpochBefore,
  );
  const afterSlotId = await attachAndBind(
    aliceDevice,
    aliceStore,
    document.documentId,
    "after.txt",
    "after-revocation-secret",
  );

  // Neither Bob's original device nor a fresh Bob install sees the new file.
  const bobAfter = await readDocument(bobDevice, world.documentRef(document));
  expect(bobAfter?.getSnapshot().attachments.map((item) => item.name)).toEqual([
    "before.txt",
  ]);
  expect(bobAfter?.getSnapshot().text).toBe("v1");
  const bobFresh = await world.newDevice(bob);
  expect(await readDocument(bobFresh, world.documentRef(document))).toBeNull();

  // Carol and a fresh Alice install decrypt both historical and post-revocation
  // attachments across the content-key rotation.
  const aliceFresh = await world.newDevice(alice);
  for (const reader of [carolDevice, aliceFresh]) {
    expect(await readText(reader, world.documentRef(document))).toBe(
      "v2 after bob revoked",
    );
    expect(
      await readAttachmentText(reader, world, document, "before.txt"),
    ).toBe("before-revocation-secret");
    expect(await readAttachmentText(reader, world, document, "after.txt")).toBe(
      "after-revocation-secret",
    );
  }

  // Removing an attachment detaches it on the API and clears it on peers.
  aliceStore.removeAttachment(beforeSlotId);
  await until(
    async () =>
      !(
        await listServerAttachmentSlotIds(aliceDevice, document.documentId)
      ).includes(beforeSlotId),
    "before.txt to detach",
  );
  await aliceDevice.idle();
  const carolAfterRemove = await readDocument(
    carolDevice,
    world.documentRef(document),
  );
  expect(
    carolAfterRemove?.getSnapshot().attachments.map((item) => item.slotId),
  ).toEqual([afterSlotId]);
  expectNoSecurityIncidents(world);
}, 240_000);

// An attachment upload racing another member's edit to the same document is
// refused by the API with 409 `attachment_document_changed` because the bind's
// checked version lacks that edit. The uploader pulls the edit, retries the
// bind at a version covering it, and both the edit and the file converge on
// every device.
test("an attachment bind racing a peer edit retries at a version covering both", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "seed\n");
  await world.shareWithUser(alice, folder, bob);
  const aliceDevice = alice.devices[0];
  const bobDevice = bob.devices[0];
  if (!aliceDevice || !bobDevice) throw new Error("Expected original devices");

  const bobStore = await readDocument(bobDevice, world.documentRef(document));
  if (!bobStore) throw bobDevice.failure("cannot open document");
  expect(bobStore.getSnapshot().text).toBe("seed\n");

  const isBind = (request: { method: string; path: string }) =>
    request.method === "POST" && request.path.endsWith("/attachment-bindings");
  const beforeBind = bobDevice.transport.history.length;
  const heldBind = bobDevice.transport.hold("before-request", isBind);

  bobStore.attachFiles([
    {
      bytes: bytesOf("bob-attachment-payload"),
      mimeType: "text/plain",
      name: "report.txt",
    },
  ]);
  await heldBind.wait();

  // While Bob's bind waits at the network, Alice commits an edit.
  await world.editDocument(alice, document, "seed\nalice edited first\n");
  heldBind.release();

  await until(
    async () =>
      (await listServerAttachmentSlotIds(bobDevice, document.documentId))
        .length === 1,
    "Bob's retried attachment bind to commit",
  );
  await bobDevice.idle();

  const bindAttempts = bobDevice.transport.history
    .slice(beforeBind)
    .filter(isBind)
    .map(({ status, errorCode }) => ({ status, errorCode }));
  expect(bindAttempts).toEqual([
    { status: 409, errorCode: "attachment_document_changed" },
    { status: 200, errorCode: undefined },
  ]);

  expect(bobStore.getSnapshot().text).toBe("seed\nalice edited first\n");
  const aliceFresh = await world.newDevice(alice);
  for (const reader of [aliceDevice, aliceFresh]) {
    expect(await readText(reader, world.documentRef(document))).toBe(
      "seed\nalice edited first\n",
    );
    expect(
      await readAttachmentText(reader, world, document, "report.txt"),
    ).toBe("bob-attachment-payload");
  }
  expectNoSecurityIncidents(world);
}, 240_000);
