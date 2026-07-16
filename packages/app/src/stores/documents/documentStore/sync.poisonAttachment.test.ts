import { expect, test } from "bun:test";
import {
  createDocumentStore,
  createMemoryBlobStore,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { cloneDocumentsTestRuntime } from "../../../../test/helpers/document-store/documentStoreSyncFixtures";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createSyncRuntime } from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

// Regression: a pending attachment whose local bytes are gone (an evicted or
// rolled-away blob) used to wedge the WHOLE document's sync forever —
// syncPendingAttachmentUpload returned false without clearing the row, and
// runDocumentSyncPass bails while pendingAttachments is non-empty, so the
// document's own CRDT updates never synced, across restarts, with no way to
// clear it. The unuploadable row must now be dropped so document sync proceeds.
test("a pending attachment with missing local bytes does not block document sync", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();

  // Accepts writes but always reports bytes as missing on read — the "poison"
  // pending attachment whose blob can never be uploaded.
  const baseBlobStore = createMemoryBlobStore();
  const blobStore: typeof baseBlobStore = {
    deleteBytes: (storageKey) => baseBlobStore.deleteBytes(storageKey),
    openByteSource: async () => null,
    readBytes: async () => null,
    writeByteSource: (storageKey, source) =>
      baseBlobStore.writeByteSource(storageKey, source),
    writeBytes: (storageKey, bytes) =>
      baseBlobStore.writeBytes(storageKey, bytes),
  };

  const runtimeInput = await createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
  );
  const runtime = cloneDocumentsTestRuntime(runtimeInput, {
    infra: { blobStore },
  });
  const store = createDocumentStore("poison-attachment", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Poison-attachment document store did not become ready.",
  );

  store.setText("hello");
  store.attachFiles([
    {
      bytes: new TextEncoder().encode("gone"),
      mimeType: "image/png",
      name: "gone.png",
    },
  ]);

  // The unuploadable attachment is dropped, and the document's own updates sync
  // instead of being blocked behind it. (Before the fix this never drains.)
  await waitForCondition(
    () =>
      persistence.getState().pendingAttachments.length === 0 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().document?.documentId != null &&
      !store.getSnapshot().syncing,
    "Poison attachment blocked document sync (pending updates never drained).",
    8_000,
  );

  expect(persistence.getState().pendingAttachments).toHaveLength(0);
  expect(persistence.getState().pendingUpdates).toHaveLength(0);
  expect(persistence.getState().document?.documentId).toBeString();
}, 15_000);
