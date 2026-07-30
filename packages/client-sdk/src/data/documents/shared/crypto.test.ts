import { expect, test } from "bun:test";
import { computeDocumentContentRecordPlaintextHash } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  exportFullHistorySnapshot,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
} from "../../../../test/helpers/documentFixtures";
import { buildMaterializedDocumentSyncPlan } from "../../../workflows/documents/sync";
import { decryptDocumentSyncUpdates } from "./crypto";
import { assertDocumentUpdatePlaintextHash } from "./plaintextHash";

test("plaintext hashes distinguish forged content with the same version-vector shape", async () => {
  const honest = await createDocument("plaintext-hash-proof");
  honest.getText("text").update("honest history");
  const honestSnapshot = exportFullHistorySnapshot(honest);

  const forged = await createDocument("plaintext-hash-proof");
  forged.getText("text").update("forged history");
  const forgedSnapshot = exportFullHistorySnapshot(forged);

  expect(getUpdateVersionVectors(forgedSnapshot)).toEqual(
    getUpdateVersionVectors(honestSnapshot),
  );
  const honestHash =
    await computeDocumentContentRecordPlaintextHash(honestSnapshot);
  expect(
    await computeDocumentContentRecordPlaintextHash(forgedSnapshot),
  ).not.toBe(honestHash);
  await expect(
    assertDocumentUpdatePlaintextHash(forgedSnapshot, honestHash),
  ).rejects.toThrow("Document update plaintext hash mismatch");
});

test("decryptDocumentSyncUpdates verifies and decrypts content records", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const response = await createSyncResponse(materialized.plan);

  const decrypted = await decryptDocumentSyncUpdates({
    contentKey,
    contentKeyEpoch: materialized.plan.contentKeyEpoch,
    documentId: materialized.plan.documentId,
    organizationId: materialized.plan.organizationId,
    updates: response.updates,
  });

  expect(decrypted).toHaveLength(1);
  expect(decrypted[0]?.id).toBe("550e8400-e29b-41d4-a716-446655440444");
  const updateData = decrypted[0]?.updateData;
  if (!updateData) {
    throw new Error("Expected decrypted update data");
  }
  const reader = await createDocument("crypto-test-reader");
  importUpdates(reader, [updateData]);
  expect(getTextValue(reader)).toBe("materialized update");

  await expect(
    decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: response.updates.map((update) => ({
        ...update,
        encryptedData: update.encryptedData.replace(
          "tearleads.document.loro-update",
          "tearleads.document.loro-update.invalid",
        ),
      })),
    }),
  ).rejects.toThrow("format is invalid");

  await expect(
    decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: response.updates.map((update) => ({
        ...update,
        encryptedData: JSON.stringify({
          ...(JSON.parse(update.encryptedData) as Record<string, unknown>),
          version: 2,
        }),
      })),
    }),
  ).rejects.toThrow(
    "Document encrypted update version 2 is invalid; expected 1",
  );
});

test("decryptDocumentSyncUpdates rejects signed outer vectors that do not match the Loro payload", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        partialEndVersionVector: "AA==",
        partialStartVersionVector: "AA==",
      }),
    ],
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });

  await expect(
    decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: (await createSyncResponse(materialized.plan)).updates,
    }),
  ).rejects.toThrow("decrypted update version-vector mismatch");
});

test("decryptDocumentSyncUpdates rejects a dependency-bearing update labeled as a rotation baseline", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const ordinaryUpdate = createPendingUpdateRecord();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      {
        ...ordinaryUpdate,
        sourceVersionVector: ordinaryUpdate.partialEndVersionVector,
      },
    ],
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });

  await expect(
    decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: (await createSyncResponse(materialized.plan)).updates,
    }),
  ).rejects.toThrow("rotation baseline is not a full-history snapshot");
});

test("decryptDocumentSyncUpdates rejects a snapshot labeled as an ordinary update", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const document = await createDocument("ordinary-snapshot-payload");
  document.getText("text").update("snapshot state");
  document.commit();
  const snapshot = exportFullHistorySnapshot(document);
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        updateData: bytesToBase64(snapshot),
        ...getUpdateVersionVectors(snapshot),
      }),
    ],
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });

  await expect(
    decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: (await createSyncResponse(materialized.plan)).updates,
    }),
  ).rejects.toThrow("ordinary update payload is not an update blob");
});
