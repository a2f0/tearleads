import { expect, test } from "bun:test";
import {
  type BlobByteSource,
  createDocumentStore,
  createMemoryBlobStore,
} from "@symcrypt/client-sdk";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import {
  createDocumentStorePersistence,
  createDocumentStoreRuntime,
} from "../../../../test/helpers/documentStoreFixtures";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

function createTrackedMemoryBlobStore() {
  const blobStore = createMemoryBlobStore();
  const storageKeys = new Set<string>();

  return {
    blobStore: {
      async deleteBytes(storageKey: string) {
        storageKeys.delete(storageKey);
        await blobStore.deleteBytes(storageKey);
      },
      openByteSource: (storageKey: string) =>
        blobStore.openByteSource(storageKey),
      readBytes: (storageKey: string) => blobStore.readBytes(storageKey),
      async writeByteSource(storageKey: string, source: BlobByteSource) {
        storageKeys.add(storageKey);
        await blobStore.writeByteSource(storageKey, source);
      },
      async writeBytes(storageKey: string, bytes: Uint8Array<ArrayBuffer>) {
        storageKeys.add(storageKey);
        await blobStore.writeBytes(storageKey, bytes);
      },
    },
    storageKeys,
  };
}

test("document store attaches files locally without authentication or network", async () => {
  const persistence = createDocumentStorePersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const blobStore = createMemoryBlobStore();
  const runtime = createDocumentStoreRuntime({
    crypto: {
      encapsulationKeyPair,
    },
    infra: {
      blobStore,
    },
  });
  const store = createDocumentStore(
    "offline-attachment-document",
    runtime,
    persistence,
  );
  store.updateRuntime(runtime);

  await store.attachFiles([
    {
      bytes: new TextEncoder().encode("offline bytes"),
      mimeType: "image/png",
      name: "offline.png",
    },
  ]);

  expect(store.getSnapshot().canAttach).toBe(true);

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

test("document store removes local-only attachments and stored bytes", async () => {
  const persistence = createDocumentStorePersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const { blobStore, storageKeys } = createTrackedMemoryBlobStore();
  const runtime = createDocumentStoreRuntime({
    crypto: {
      encapsulationKeyPair,
    },
    infra: {
      blobStore,
    },
  });
  const store = createDocumentStore(
    "remove-local-attachment-document",
    runtime,
    persistence,
  );
  store.updateRuntime(runtime);

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("remove me"),
      mimeType: "text/plain",
      name: "remove-me.txt",
    },
  ]);

  await waitForCondition(
    () =>
      store.getSnapshot().attachments.length === 1 && storageKeys.size === 1,
    "Local attachment was not staged before removal.",
  );

  const slotId = store.getSnapshot().attachments[0]?.slotId;
  expect(slotId).toBeString();
  store.removeAttachment(slotId ?? "");

  await waitForCondition(
    () =>
      store.getSnapshot().attachments.length === 0 &&
      persistence.getState().pendingAttachments.length === 0 &&
      persistence.getState().localAttachments.length === 0 &&
      storageKeys.size === 0,
    "Local attachment was not removed.",
  );
});

test("document store rolls back staged attachment rows and bytes when local attachment persistence fails", async () => {
  const basePersistence = createDocumentStorePersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const { blobStore, storageKeys } = createTrackedMemoryBlobStore();
  const runtime = createDocumentStoreRuntime({
    crypto: {
      encapsulationKeyPair,
    },
    infra: {
      blobStore,
    },
  });
  let attemptedLocalSave = false;
  const persistence = {
    ...basePersistence,
    async saveLocalAttachment(
      ...input: Parameters<typeof basePersistence.saveLocalAttachment>
    ) {
      attemptedLocalSave = true;
      await basePersistence.saveLocalAttachment(...input);
      throw new Error("forced local attachment save failure");
    },
  };
  const store = createDocumentStore(
    "rollback-attachment-document",
    runtime,
    persistence,
  );
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Rollback attachment document store did not become ready.",
  );

  const previousConsoleError = console.error;
  console.error = () => {};
  try {
    store.attachFiles([
      {
        bytes: new TextEncoder().encode("rollback bytes"),
        mimeType: "image/png",
        name: "rollback.png",
      },
    ]);

    await waitForCondition(
      () => attemptedLocalSave && storageKeys.size === 0,
      "Staged attachment bytes were not rolled back.",
    );
  } finally {
    console.error = previousConsoleError;
  }

  expect(persistence.getState().localAttachments).toHaveLength(0);
  expect(persistence.getState().pendingAttachments).toHaveLength(0);
  expect(store.getSnapshot().attachments).toHaveLength(0);
});
