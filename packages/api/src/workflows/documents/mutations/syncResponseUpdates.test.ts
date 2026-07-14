import { expect, test } from "bun:test";
import { computeDocumentContentRecordMetadataHash } from "@tearleads/crypto";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
} from "@tearleads/loro";
import {
  authenticateSyncCheckpointForResponse,
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
  const checkpoint = {
    ...CHECKPOINT,
    sourceVersionVector: partialEndVersionVector,
  };
  return {
    checkpoint,
    documentId,
    partialEndVersionVector,
    partialStartVersionVector,
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

test("fails a sync response closed for a legacy unauthenticated checkpoint", async () => {
  const fixture = await checkpointFixture();
  const legacyMetadataHash = await computeDocumentContentRecordMetadataHash({
    documentId: fixture.documentId,
    partialEndVersionVector: fixture.partialEndVersionVector,
    partialStartVersionVector: fixture.partialStartVersionVector,
    updateId: fixture.updateId,
  });

  await expect(
    authenticateSyncCheckpointForResponse({
      ...fixture,
      metadataHash: legacyMetadataHash,
    }),
  ).rejects.toMatchObject({
    message: "Document rotation checkpoint failed integrity validation",
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
