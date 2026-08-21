import { expect, test } from "bun:test";
import {
  createDocumentStore,
  createMemoryBlobStore,
} from "@symcrypt/client-sdk";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import { cloneDocumentsTestRuntime } from "../../../../test/helpers/document-store/documentStoreSyncFixtures";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createOfflineAttachmentRuntime } from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

test("document store attaches files locally without authentication or network", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const blobStore = createMemoryBlobStore();
  const runtime = createOfflineAttachmentRuntime(
    encapsulationKeyPair,
    "offline-container",
  );
  const offlineRuntime = cloneDocumentsTestRuntime(runtime, {
    infra: {
      blobStore,
    },
  });
  const store = createDocumentStore(
    "offline-attachment-note",
    offlineRuntime,
    persistence,
  );
  store.updateRuntime(offlineRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Offline attachment document store did not become ready.",
  );

  expect(store.getSnapshot().canAttach).toBe(true);

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("offline bytes"),
      mimeType: "image/png",
      name: "offline.png",
    },
  ]);

  await waitForCondition(
    () =>
      store.getSnapshot().attachments.length === 1 &&
      persistence.getState().pendingAttachments.length === 1 &&
      persistence.getState().pendingAttachments[0]?.name === "offline.png",
    "Offline attachment was not stored locally.",
  );

  const slotId = store.getSnapshot().attachments[0]?.slotId;
  const storageKey = slotId
    ? store.getSnapshot().attachmentStorageKeyBySlotId[slotId]
    : undefined;
  const persistedBytes = storageKey
    ? await blobStore.readBytes(storageKey)
    : null;

  expect(storageKey).toBeString();
  expect(new TextDecoder().decode(persistedBytes ?? new Uint8Array())).toBe(
    "offline bytes",
  );
});
