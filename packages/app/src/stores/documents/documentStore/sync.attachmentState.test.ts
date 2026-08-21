import { expect, test } from "bun:test";
import { createDocumentStore } from "@symcrypt/client-sdk";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import type { BlobAttachmentBindRequest } from "@symcrypt/validators/request";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import {
  createRuntime,
  createSyncRuntime,
} from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

test("document store preserves a replacement queued during attachment upload", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const attachmentBinds: Array<{
    blobId: string;
    request: BlobAttachmentBindRequest;
  }> = [];
  const listDocumentAttachmentsCalls: string[] = [];
  let replacementQueued = false;
  let store: ReturnType<typeof createDocumentStore>;
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
    {
      attachmentBinds,
      listDocumentAttachmentsCalls,
      onBindBlobAttachment: async () => {
        if (replacementQueued) {
          return;
        }

        const slotId = store.getSnapshot().attachments[0]?.slotId;
        if (!slotId) {
          throw new Error("Expected an attachment slot before replacement.");
        }

        replacementQueued = true;
        store.replaceAttachment(slotId, {
          bytes: new TextEncoder().encode("replacement bytes"),
          mimeType: "image/png",
          name: "replacement.png",
        });

        await waitForCondition(
          () =>
            persistence
              .getState()
              .pendingAttachments.some(
                (attachment) =>
                  attachment.slotId === slotId &&
                  attachment.name === "replacement.png",
              ),
          "Replacement attachment was not queued during upload.",
        );
      },
    },
  );
  store = createDocumentStore("attachment-replacement", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Attachment replacement document store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("original bytes"),
      mimeType: "image/png",
      name: "original.png",
    },
  ]);

  await waitForCondition(
    () =>
      attachmentBinds.length === 2 &&
      persistence.getState().pendingAttachments.length === 0 &&
      persistence.getState().localAttachments[0]?.blobId !== null &&
      store.getSnapshot().attachments[0]?.name === "replacement.png",
    "Replacement attachment was not uploaded after the original upload completed.",
  );

  const localAttachment = persistence.getState().localAttachments[0];
  if (!localAttachment) {
    throw new Error("Expected a local attachment after replacement upload.");
  }

  const storedBytes = await runtime.infra.blobStore.readBytes(
    localAttachment.storageKey,
  );
  const documentId = persistence.getState().document?.documentId;
  if (!documentId) {
    throw new Error("Expected a remote document after replacement upload.");
  }
  expect(attachmentBinds).toHaveLength(2);
  expect(new Set(listDocumentAttachmentsCalls)).toEqual(new Set([documentId]));
  expect(persistence.getState().pendingAttachments).toHaveLength(0);
  expect(store.getSnapshot().attachments[0]?.name).toBe("replacement.png");
  expect(new TextDecoder().decode(storedBytes ?? new Uint8Array())).toBe(
    "replacement bytes",
  );
});

test("document store keeps prior attachments when a second file is attached", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
  );
  const store = createDocumentStore(
    "attachment-sequence",
    runtime,
    persistence,
  );
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Sequential attachment document store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("first"),
      mimeType: "image/png",
      name: "first.png",
    },
  ]);

  await waitForCondition(
    () => store.getSnapshot().attachments.length === 1,
    "First attachment did not persist.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("second"),
      mimeType: "image/png",
      name: "second.png",
    },
  ]);

  await waitForCondition(
    () => store.getSnapshot().attachments.length === 2,
    "Second attachment did not persist.",
  );

  expect(
    store.getSnapshot().attachments.map((attachment) => attachment.name),
  ).toEqual(["first.png", "second.png"]);
});

test("document store reloads persisted attachment metadata from the note snapshot", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = await createSyncRuntime(encapsulationKeyPair);
  const firstStore = createDocumentStore(
    "attachment-reload",
    runtime,
    persistence,
  );
  firstStore.updateRuntime(runtime);

  await waitForCondition(
    () => firstStore.getSnapshot().ready,
    "First attachment document store did not become ready.",
  );

  firstStore.attachFiles([
    {
      bytes: new TextEncoder().encode("persisted attachment"),
      mimeType: "text/plain",
      name: "persisted.txt",
    },
  ]);

  await waitForCondition(
    () => firstStore.getSnapshot().attachments.length === 1,
    "Attachment metadata was not persisted to the first document store.",
  );

  const secondStore = createDocumentStore(
    "attachment-reload",
    createRuntime(),
    persistence,
  );
  secondStore.updateRuntime(createRuntime());

  await waitForCondition(
    () => secondStore.getSnapshot().ready,
    "Second attachment document store did not become ready.",
  );

  expect(secondStore.getSnapshot().attachments).toEqual([
    {
      byteLength: "persisted attachment".length,
      mimeType: "text/plain",
      name: "persisted.txt",
      slotId: firstStore.getSnapshot().attachments[0]?.slotId ?? "",
    },
  ]);
});

test("document store revalidates before uploading attachments", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const attachmentBinds: Array<{
    blobId: string;
    request: BlobAttachmentBindRequest;
  }> = [];
  const syncCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const documentWriterProjectionCalls: string[] = [];
  const listDocumentAttachmentsCalls: string[] = [];
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
    {
      attachmentBinds,
      commitLsnForSyncCount: (syncCount) => `0/${syncCount}0`,
      documentWriterProjectionCalls,
      listDocumentAttachmentsCalls,
      syncCalls,
    },
  );
  const store = createDocumentStore("attachment-probe", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () =>
      syncCalls.length === 1 &&
      persistence.getState().document?.documentId != null &&
      !store.getSnapshot().syncing,
    "Untouched store did not settle its initial create flush.",
  );

  store.setText("remote attachment note");

  await waitForCondition(
    () =>
      persistence.getState().pendingUpdates.length === 0 &&
      syncCalls.length === 2,
    "Attachment probe note was not synced before uploading.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("attachment probe bytes"),
      mimeType: "image/png",
      name: "probe.png",
    },
  ]);

  await waitForCondition(
    () =>
      attachmentBinds.length === 1 &&
      persistence.getState().pendingAttachments.length === 0 &&
      syncCalls.length === 4 &&
      !store.getSnapshot().syncing,
    "Attachment upload did not complete after document revalidation.",
    2_000,
    10,
  );

  expect(syncCalls).toEqual([
    {
      minLsn: null,
      outgoingUpdateCount: 0,
    },
    {
      minLsn: "0/10",
      outgoingUpdateCount: 1,
    },
    {
      minLsn: "0/20",
      outgoingUpdateCount: 0,
    },
    {
      minLsn: "0/30",
      outgoingUpdateCount: 1,
    },
  ]);
  expect(attachmentBinds).toHaveLength(1);
  expect(documentWriterProjectionCalls).toEqual([]);
  const syncedDocumentId = persistence.getState().document?.documentId;
  if (!syncedDocumentId) {
    throw new Error("Expected a synced document after attachment upload.");
  }
  expect(listDocumentAttachmentsCalls).toEqual([
    syncedDocumentId,
    syncedDocumentId,
  ]);
});

test("document store marks a synced attachment detached before the detach flushes", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const attachmentBinds: Array<{
    blobId: string;
    request: BlobAttachmentBindRequest;
  }> = [];
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
    { attachmentBinds },
  );
  const store = createDocumentStore("attachment-unlink", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Attachment unlink document store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("unlink me"),
      mimeType: "image/png",
      name: "unlink.png",
    },
  ]);

  await waitForCondition(
    () =>
      attachmentBinds.length === 1 &&
      persistence.getState().localAttachments[0]?.blobId != null,
    "Attachment was not bound before the unlink.",
    2_000,
    10,
  );

  const slotId = store.getSnapshot().attachments[0]?.slotId;
  expect(slotId).toBeString();
  await store.removeAttachment(slotId ?? "");

  // The mock api client cannot detach, so this asserts the state the app is
  // left in while the detach is still owed to the server: the row survives as
  // the detach marker, but it no longer counts as a live blob reference.
  const localAttachment = persistence.getState().localAttachments[0];
  expect(persistence.getState().localAttachments).toHaveLength(1);
  expect(localAttachment?.slotId).toBe(slotId ?? "");
  expect(localAttachment?.detachedAt).toBeString();
  expect(store.getSnapshot().attachments).toEqual([]);
});

test("document store keeps an attachment detached when its in-flight upload settles", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  let store: ReturnType<typeof createDocumentStore>;
  let removalDuringBind: Promise<void> | undefined;
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
    {
      // Unlink the slot while its bind is in flight. The upload settles
      // afterwards and writes the slot's local row; that write must not clear
      // the detach marker the removal just set.
      onBindBlobAttachment: async () => {
        removalDuringBind ??= (async () => {
          const slotId = store.getSnapshot().attachments[0]?.slotId;
          if (!slotId) {
            throw new Error("Expected an attachment slot before removal.");
          }
          await store.removeAttachment(slotId);
        })();
        await removalDuringBind;
      },
    },
  );
  store = createDocumentStore("attachment-unlink-race", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Attachment unlink race document store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("racing bytes"),
      mimeType: "image/png",
      name: "racing.png",
    },
  ]);

  await waitForCondition(
    () =>
      removalDuringBind !== undefined &&
      persistence.getState().localAttachments[0]?.blobId != null,
    "Attachment upload did not settle after the unlink.",
    2_000,
    10,
  );

  expect(store.getSnapshot().attachments).toEqual([]);
  expect(persistence.getState().localAttachments[0]?.detachedAt).toBeString();
});
