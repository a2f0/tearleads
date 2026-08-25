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

test("a failed attachment removal restores the document and attachment rows", async () => {
  const basePersistence = createDocumentStorePersistence();
  let failRemoval = false;
  const persistence = {
    ...basePersistence,
    async commitDocumentMutation(
      ...input: Parameters<typeof basePersistence.commitDocumentMutation>
    ) {
      if (failRemoval && input[1].attachmentRemoval) {
        failRemoval = false;
        throw new Error("forced attachment removal failure");
      }
      return basePersistence.commitDocumentMutation(...input);
    },
  };
  const { blobStore, storageKeys } = createTrackedMemoryBlobStore();
  const runtime = createDocumentStoreRuntime({
    crypto: { encapsulationKeyPair: generateKemSeedAndKeyPair() },
    infra: { blobStore },
  });
  const store = createDocumentStore(
    "rollback-attachment-removal",
    runtime,
    persistence,
  );
  store.updateRuntime(runtime);
  await store.attachFiles([
    {
      bytes: new TextEncoder().encode("must survive"),
      mimeType: "text/plain",
      name: "retained.txt",
    },
  ]);
  const pendingAttachment = persistence.getState().pendingAttachments[0];
  const localAttachment = persistence.getState().localAttachments[0];
  const slotId = store.getSnapshot().attachments[0]?.slotId;
  if (!pendingAttachment || !localAttachment || !slotId) {
    throw new Error("Expected a staged attachment");
  }

  failRemoval = true;
  const previousConsoleError = console.error;
  console.error = () => {};
  try {
    await store.removeAttachment(slotId);
  } finally {
    console.error = previousConsoleError;
  }

  expect(store.getSnapshot().attachments).toEqual([
    {
      byteLength: pendingAttachment.byteLength,
      mimeType: pendingAttachment.mimeType,
      name: pendingAttachment.name,
      slotId,
    },
  ]);
  expect(persistence.getState().pendingAttachments).toEqual([
    pendingAttachment,
  ]);
  expect(persistence.getState().localAttachments).toEqual([localAttachment]);
  expect(storageKeys).toEqual(new Set([pendingAttachment.storageKey]));
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
  let attemptedStagingCommit = false;
  let recoveryLoadCount = 0;
  const persistence = {
    ...basePersistence,
    async loadDocumentWithHistoryRestoreState(
      ...input: Parameters<
        typeof basePersistence.loadDocumentWithHistoryRestoreState
      >
    ) {
      if (attemptedStagingCommit) recoveryLoadCount += 1;
      return basePersistence.loadDocumentWithHistoryRestoreState(...input);
    },
    async commitDocumentMutation(
      ...input: Parameters<typeof basePersistence.commitDocumentMutation>
    ) {
      if (input[1].attachmentStaging) {
        attemptedStagingCommit = true;
        throw new Error("forced attachment staging failure");
      }
      return basePersistence.commitDocumentMutation(...input);
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
    await store.attachFiles([
      {
        bytes: new TextEncoder().encode("rollback bytes"),
        mimeType: "image/png",
        name: "rollback.png",
      },
    ]);

    await waitForCondition(
      () => attemptedStagingCommit && storageKeys.size === 0,
      "Staged attachment bytes were not rolled back.",
    );
  } finally {
    console.error = previousConsoleError;
  }

  expect(persistence.getState().localAttachments).toHaveLength(0);
  expect(persistence.getState().pendingAttachments).toHaveLength(0);
  expect(recoveryLoadCount).toBeGreaterThan(0);
  expect(store.getSnapshot().attachments).toHaveLength(0);
  await store.setText("edit after failed attachment staging");
  expect(store.getSnapshot().text).toBe("edit after failed attachment staging");
  expect(store.getSnapshot().attachments).toHaveLength(0);
});

test("a failed slot replacement restores the displaced attachment rows", async () => {
  const basePersistence = createDocumentStorePersistence();
  const { blobStore, storageKeys } = createTrackedMemoryBlobStore();
  let failStagingCommit = false;
  const persistence = {
    ...basePersistence,
    async commitDocumentMutation(
      ...input: Parameters<typeof basePersistence.commitDocumentMutation>
    ) {
      if (failStagingCommit && input[1].attachmentStaging) {
        failStagingCommit = false;
        throw new Error("forced replacement save failure");
      }
      return basePersistence.commitDocumentMutation(...input);
    },
  };
  const runtime = createDocumentStoreRuntime({
    crypto: { encapsulationKeyPair: generateKemSeedAndKeyPair() },
    infra: { blobStore },
  });
  const store = createDocumentStore(
    "rollback-replacement-document",
    runtime,
    persistence,
  );
  store.updateRuntime(runtime);

  await store.attachFiles([
    {
      bytes: new TextEncoder().encode("original bytes"),
      mimeType: "text/plain",
      name: "original.txt",
    },
  ]);
  await waitForCondition(
    () => persistence.getState().pendingAttachments.length === 1,
    "Original attachment was not staged.",
  );
  const originalPending = persistence.getState().pendingAttachments[0];
  const originalLocal = persistence.getState().localAttachments[0];
  if (!originalPending || !originalLocal) {
    throw new Error("Expected original attachment rows");
  }

  failStagingCommit = true;
  const previousConsoleError = console.error;
  console.error = () => {};
  try {
    await store.replaceAttachment(originalPending.slotId, {
      bytes: new TextEncoder().encode("replacement bytes"),
      mimeType: "text/plain",
      name: "replacement.txt",
    });
  } finally {
    console.error = previousConsoleError;
  }

  expect(persistence.getState().pendingAttachments).toEqual([originalPending]);
  expect(persistence.getState().localAttachments).toEqual([originalLocal]);
  expect(storageKeys).toEqual(new Set([originalPending.storageKey]));
  await store.setText("edit after failed replacement");
  expect(store.getSnapshot().attachments).toEqual([
    {
      byteLength: originalPending.byteLength,
      mimeType: originalPending.mimeType,
      name: originalPending.name,
      slotId: originalPending.slotId,
    },
  ]);
});

test("a stale attachment pane cannot stage rows after another pane relinks", async () => {
  const basePersistence = createDocumentStorePersistence();
  const { blobStore, storageKeys } = createTrackedMemoryBlobStore();
  let relinkOnNextAttachmentCommit = false;
  const persistence = {
    ...basePersistence,
    async commitDocumentMutation(
      ...input: Parameters<typeof basePersistence.commitDocumentMutation>
    ) {
      if (relinkOnNextAttachmentCommit && input[1].attachmentStaging) {
        relinkOnNextAttachmentCommit = false;
        await basePersistence.relinkPersistedDocument(input[0], {
          accessEpoch: 2,
          containerId: "replacement-container",
          documentId: "replacement-document",
          localId: "attachment-relink-race",
        });
      }
      return basePersistence.commitDocumentMutation(...input);
    },
  };
  const runtime = createDocumentStoreRuntime({
    crypto: { encapsulationKeyPair: generateKemSeedAndKeyPair() },
    infra: { blobStore },
  });
  const store = createDocumentStore(
    "attachment-relink-race",
    runtime,
    persistence,
  );
  store.updateRuntime(runtime);
  await waitForCondition(
    () => store.getSnapshot().ready,
    "Attachment race document store did not become ready.",
  );

  relinkOnNextAttachmentCommit = true;
  await store.attachFiles([
    {
      bytes: new TextEncoder().encode("stale attachment bytes"),
      mimeType: "text/plain",
      name: "stale.txt",
    },
  ]);

  await waitForCondition(
    () => store.getSnapshot().documentId === "replacement-document",
    "The stale attachment pane did not adopt the replacement identity.",
  );
  expect(persistence.getState().pendingAttachments).toEqual([]);
  expect(persistence.getState().localAttachments).toEqual([]);
  expect(persistence.getState().pendingUpdates).toEqual([]);
  expect(storageKeys.size).toBe(0);
});

test("a stale attachment removal cannot cross a relink", async () => {
  const localId = "attachment-removal-relink-race";
  const basePersistence = createDocumentStorePersistence();
  const { blobStore, storageKeys } = createTrackedMemoryBlobStore();
  let relinkOnRemoval = false;
  const persistence = {
    ...basePersistence,
    async commitDocumentMutation(
      ...input: Parameters<typeof basePersistence.commitDocumentMutation>
    ) {
      if (relinkOnRemoval && input[1].attachmentRemoval) {
        relinkOnRemoval = false;
        await basePersistence.relinkPersistedDocument(input[0], {
          accessEpoch: 2,
          containerId: "replacement-container",
          documentId: "replacement-document",
          localId,
        });
      }
      return basePersistence.commitDocumentMutation(...input);
    },
  };
  const runtime = createDocumentStoreRuntime({
    crypto: { encapsulationKeyPair: generateKemSeedAndKeyPair() },
    infra: { blobStore },
  });
  const store = createDocumentStore(localId, runtime, persistence);
  store.updateRuntime(runtime);
  await store.attachFiles([
    {
      bytes: new TextEncoder().encode("retained bytes"),
      mimeType: "text/plain",
      name: "retained.txt",
    },
  ]);
  const slotId = store.getSnapshot().attachments[0]?.slotId;
  if (!slotId) throw new Error("Expected the staged attachment slot");

  relinkOnRemoval = true;
  await store.removeAttachment(slotId);

  expect(store.getSnapshot()).toMatchObject({
    documentId: "replacement-document",
    attachments: [{ name: "retained.txt", slotId }],
  });
  expect(basePersistence.getState().pendingAttachments).toHaveLength(1);
  expect(basePersistence.getState().localAttachments).toHaveLength(1);
  expect(storageKeys.size).toBe(1);
});
