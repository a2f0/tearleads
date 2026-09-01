import { expect, test } from "bun:test";
import { verifyWriteHeader, type WriteHeader } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  exportFullHistorySnapshot,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { isDocumentSyncRequest } from "@tearleads/validators/request";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
} from "../../../test/helpers/documentFixtures";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

async function createFullHistoryPendingUpdate(text: string) {
  const doc = await createDocument(`sync-checkpoint-fixture:${text}`);
  doc.getText("text").update(text);
  doc.commit();
  const snapshot = exportFullHistorySnapshot(doc);
  const vectors = getUpdateVersionVectors(snapshot);
  return createPendingUpdateRecord({
    sourceVersionVector: vectors.partialEndVersionVector,
    updateData: bytesToBase64(snapshot),
    ...vectors,
  });
}

test("materialized sync encrypts and signs a full-history checkpoint", async () => {
  const { author, contentKey, secretKey, signingPublicKey, writerProjection } =
    await createMaterializedSyncFixture();
  const pendingCheckpoint = await createFullHistoryPendingUpdate(
    "materialized update",
  );
  if (pendingCheckpoint.sourceVersionVector === null) {
    throw new Error("Expected checkpoint source version vector");
  }
  const plan = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [pendingCheckpoint],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });

  expect(Array.from(plan.contentKey)).toEqual(Array.from(contentKey));
  expect(isDocumentSyncRequest(plan.plan.request)).toBe(true);
  const update = plan.plan.request.outgoingUpdates[0];
  if (!update) {
    throw new Error("Expected materialized outgoing update");
  }
  expect(update.checkpointKind).toBe("rotate_baseline");
  expect(update.sourceVersionVector).toBe(
    pendingCheckpoint.sourceVersionVector,
  );
  expect(update.encryptedData).toContain("tearleads.document.loro-update");
  expect(update.encryptedData).not.toContain("materialized update");

  const writeHeader = update.writeHeader as unknown as WriteHeader;
  expect(writeHeader.contentRecordId).toBe(update.id);
  expect(writeHeader.ciphertextHash).toHaveLength(64);
  expect(writeHeader.metadataHash).toHaveLength(64);
  const verified = await verifyWriteHeader({
    expectedAccessManifestHash: writerProjection.documentManifest.manifestHash,
    expectedObject: {
      objectKind: "document",
      objectId: writerProjection.documentId,
      organizationId: author.organizationId,
    },
    expectedTargetHash: writerProjection.contentKeyBundle.targetHash,
    header: writeHeader,
    writerPublicKey: signingPublicKey,
  });
  expect(verified.ok).toBe(true);
});
