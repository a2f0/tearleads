import { expect, test } from "bun:test";
import { computeDocumentContentRecordMetadataHash } from "@symcrypt/crypto";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
} from "@symcrypt/loro";
import {
  authenticateSyncCheckpointForResponse,
  type SyncCheckpointMetadata,
  trimSyncResponseEntriesToBytes,
} from "./syncResponseUpdates";

const CHECKPOINT: SyncCheckpointMetadata = {
  checkpointKind: "rotate_baseline",
  checkpointPayloadKind: "full_history_snapshot",
  sourceVersionVector: "",
};

async function checkpointFixture() {
  const document = await createDocument("sync-response-checkpoint-test");
  document.getText("text").update("checkpoint state");
  document.commit();
  const documentId = crypto.randomUUID();
  const updateId = crypto.randomUUID();
  const partialStartVersionVector = emptyVersionVector();
  const partialEndVersionVector = encodeVersionVector(document);
  const plaintextHash = "sync-response-plaintext-hash";
  const checkpoint = {
    ...CHECKPOINT,
    sourceVersionVector: partialEndVersionVector,
  };
  return {
    checkpoint,
    documentId,
    partialEndVersionVector,
    partialStartVersionVector,
    plaintextHash,
    updateId,
  };
}

test("authenticates checkpoint metadata before adding it to a sync response", async () => {
  const fixture = await checkpointFixture();
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    checkpointKind: fixture.checkpoint.checkpointKind,
    checkpointPayloadKind: fixture.checkpoint.checkpointPayloadKind,
    documentId: fixture.documentId,
    partialEndVersionVector: fixture.partialEndVersionVector,
    partialStartVersionVector: fixture.partialStartVersionVector,
    plaintextHash: fixture.plaintextHash,
    sourceVersionVector: fixture.checkpoint.sourceVersionVector,
    updateId: fixture.updateId,
  });

  await expect(
    authenticateSyncCheckpointForResponse({
      ...fixture,
      metadataHash,
    }),
  ).resolves.toEqual(fixture.checkpoint);
});

test("fails closed when signed metadata omits checkpoint fields", async () => {
  const fixture = await checkpointFixture();
  const ordinaryMetadataHash = await computeDocumentContentRecordMetadataHash({
    documentId: fixture.documentId,
    partialEndVersionVector: fixture.partialEndVersionVector,
    partialStartVersionVector: fixture.partialStartVersionVector,
    plaintextHash: fixture.plaintextHash,
    updateId: fixture.updateId,
  });

  await expect(
    authenticateSyncCheckpointForResponse({
      ...fixture,
      metadataHash: ordinaryMetadataHash,
    }),
  ).rejects.toMatchObject({
    message: "Document rotation checkpoint failed integrity validation",
    status: 409,
  });
});

test("fails closed when checkpoint metadata matches neither supported format", async () => {
  const fixture = await checkpointFixture();

  await expect(
    authenticateSyncCheckpointForResponse({
      ...fixture,
      metadataHash: "tampered-metadata-hash",
    }),
  ).rejects.toMatchObject({
    message: "Document rotation checkpoint failed integrity validation",
    status: 409,
  });
});

test("fails closed when the stored plaintext hash differs from signed metadata", async () => {
  const fixture = await checkpointFixture();
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    checkpointKind: fixture.checkpoint.checkpointKind,
    checkpointPayloadKind: fixture.checkpoint.checkpointPayloadKind,
    documentId: fixture.documentId,
    partialEndVersionVector: fixture.partialEndVersionVector,
    partialStartVersionVector: fixture.partialStartVersionVector,
    plaintextHash: fixture.plaintextHash,
    sourceVersionVector: fixture.checkpoint.sourceVersionVector,
    updateId: fixture.updateId,
  });

  await expect(
    authenticateSyncCheckpointForResponse({
      ...fixture,
      metadataHash,
      plaintextHash: "tampered-plaintext-hash",
    }),
  ).rejects.toMatchObject({
    message: "Document rotation checkpoint failed integrity validation",
    status: 409,
  });
});

test("fails closed when an ordinary update plaintext hash differs from signed metadata", async () => {
  const fixture = await checkpointFixture();
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    documentId: fixture.documentId,
    partialEndVersionVector: fixture.partialEndVersionVector,
    partialStartVersionVector: fixture.partialStartVersionVector,
    plaintextHash: fixture.plaintextHash,
    updateId: fixture.updateId,
  });

  await expect(
    authenticateSyncCheckpointForResponse({
      checkpoint: undefined,
      documentId: fixture.documentId,
      metadataHash,
      partialEndVersionVector: fixture.partialEndVersionVector,
      partialStartVersionVector: fixture.partialStartVersionVector,
      plaintextHash: "tampered-plaintext-hash",
      updateId: fixture.updateId,
    }),
  ).rejects.toMatchObject({
    message: "Document update metadata failed integrity validation",
    status: 409,
  });
});

test("fails closed when an authenticated checkpoint lost its checkpoint row", async () => {
  const fixture = await checkpointFixture();
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    checkpointKind: fixture.checkpoint.checkpointKind,
    checkpointPayloadKind: fixture.checkpoint.checkpointPayloadKind,
    documentId: fixture.documentId,
    partialEndVersionVector: fixture.partialEndVersionVector,
    partialStartVersionVector: fixture.partialStartVersionVector,
    plaintextHash: fixture.plaintextHash,
    sourceVersionVector: fixture.checkpoint.sourceVersionVector,
    updateId: fixture.updateId,
  });

  await expect(
    authenticateSyncCheckpointForResponse({
      ...fixture,
      checkpoint: undefined,
      metadataHash,
    }),
  ).rejects.toMatchObject({
    message: "Document update metadata failed integrity validation",
    status: 409,
  });
});

test("serialized response byte trimming preserves the next unserved sequence", () => {
  const entries = [
    { sequence: 7, update: { encryptedData: "first", id: "first" } },
    { sequence: 11, update: { encryptedData: "second", id: "second" } },
  ];
  const firstItemBytes = new TextEncoder().encode(
    JSON.stringify([entries[0]?.update]),
  ).byteLength;

  expect(
    trimSyncResponseEntriesToBytes(
      entries,
      { hasMore: false, lastSequence: 11, lastUpdateId: "second" },
      firstItemBytes,
    ),
  ).toEqual({
    entries: entries.slice(0, 1),
    page: { hasMore: true, lastSequence: 7, lastUpdateId: "first" },
  });
});
