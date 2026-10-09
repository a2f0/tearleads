import { expect, test } from "bun:test";
import {
  createDocumentStore,
  createMemoryBlobStore,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createDocumentStorePersistence,
  createDocumentStoreRuntime,
} from "../../../../test/helpers/documentStoreFixtures";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

test("custom persistence preserves another pending upload sharing removed bytes", async () => {
  const persistence = createDocumentStorePersistence();
  let acknowledged = false;
  const acknowledge = persistence.orphanBlobs.acknowledge;
  persistence.orphanBlobs.acknowledge = async (execSql, storageKey) => {
    await acknowledge(execSql, storageKey);
    acknowledged = true;
  };
  const blobStore = createMemoryBlobStore();
  const runtime = createDocumentStoreRuntime({
    crypto: { encapsulationKeyPair: generateKemSeedAndKeyPair() },
    infra: { blobStore },
  });
  const store = createDocumentStore("first", runtime, persistence);
  const bytes = new Uint8Array([1, 2, 3]);
  store.attachFiles([
    { bytes, mimeType: "application/octet-stream", name: "shared" },
  ]);
  await waitForCondition(
    () => store.getSnapshot().attachments.length === 1,
    "Attachment was not staged",
  );
  const pending = persistence.getState().pendingAttachments[0];
  if (!pending) throw new Error("Expected a pending upload");
  persistence.getState().pendingAttachments.push({
    ...pending,
    localId: "second",
    slotId: "second-slot",
  });

  store.removeAttachment(pending.slotId);
  await waitForCondition(
    () => store.getSnapshot().attachments.length === 0,
    "Attachment was not removed",
  );
  await waitForCondition(() => acknowledged, "Removal was not reclaimed");
  expect(persistence.getState().pendingAttachments).toHaveLength(1);
  expect(await blobStore.readBytes(pending.storageKey)).toEqual(bytes);
});
