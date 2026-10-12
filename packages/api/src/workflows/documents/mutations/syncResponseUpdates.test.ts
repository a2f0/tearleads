import { expect, test } from "bun:test";
import { computeDocumentContentRecordMetadataHash } from "@tearleads/crypto";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
} from "@tearleads/loro";
import {
  authenticateSyncCheckpointForResponse,
  materializeSyncResponseEntriesToBytes,
  type SyncCheckpointMetadata,
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

test("serialized response byte trimming preserves the next unserved sequence", async () => {
  const entries = [
    { sequence: 7, update: { encryptedData: "first", id: "first" } },
    { sequence: 11, update: { encryptedData: "second", id: "second" } },
  ];
  const firstItemBytes = new TextEncoder().encode(
    JSON.stringify([entries[0]?.update]),
  ).byteLength;

  expect(
    await materializeSyncResponseEntriesToBytes(
      entries,
      async (entry) => entry,
      firstItemBytes,
    ),
  ).toEqual(entries.slice(0, 1));
});

test("a large history is served in pages that fit the default byte budget", async () => {
  // Each update carries just under 8 MiB; the 32 MiB default budget admits
  // four of them and stops before the fifth without materializing beyond it.
  const payload = "x".repeat(8 * 1024 * 1024 - 1024);
  const materialized: number[] = [];
  const entries = await materializeSyncResponseEntriesToBytes(
    [1, 2, 3, 4, 5, 6],
    async (sequence) => {
      materialized.push(sequence);
      return {
        sequence,
        update: { encryptedData: payload, id: `update-${sequence}` },
      };
    },
  );
  expect(entries.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4]);
  expect(materialized).toEqual([1, 2, 3, 4, 5]);
});

test("metadata entries materialize only through the first byte overflow", async () => {
  const loaded: number[] = [];
  const first = { sequence: 1, update: { id: "first" } };
  const firstItemBytes = new TextEncoder().encode(
    JSON.stringify([first.update]),
  ).byteLength;

  const entries = await materializeSyncResponseEntriesToBytes(
    [1, 2, 3],
    async (sequence) => {
      loaded.push(sequence);
      return sequence === 1
        ? first
        : {
            sequence,
            update: {
              authorizationTargets: [
                { wrappedKey: "x".repeat(firstItemBytes) },
              ],
              id: `update-${sequence}`,
            },
          };
    },
    firstItemBytes,
  );

  expect(entries).toEqual([first]);
  expect(loaded).toEqual([1, 2]);
});
