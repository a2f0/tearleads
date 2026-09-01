import { expect, test } from "bun:test";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordPlaintextHash,
  createAesGcmIv,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
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
import { buildMaterializedDocumentSyncPlan } from "../../../workflows/documents/syncPlanMaterial";
import {
  deriveDocumentContentRecordKey,
  documentContentRecordDerivationPayload,
  importContentKeyMaterial,
} from "./contentRecordKeys";
import { decryptDocumentSyncUpdates } from "./crypto";
import { isDocumentSyncUpdateIsolationError } from "./documentSyncUpdateIsolation";
import { assertDocumentUpdatePlaintextHash } from "./plaintextHash";
import {
  DOCUMENT_CONTENT_RECORD_AAD_DOMAIN,
  DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
  TEXT_ENCODER,
} from "./types";

async function importPlaintextHashTestKey(seed: number): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(32).fill(seed),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function errorCauseTree(error: unknown): unknown[] {
  const pending = [error];
  const seen = new Set<unknown>();
  const found: unknown[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    found.push(current);
    if (current instanceof AggregateError) {
      pending.push(...current.errors);
    }
    if (current instanceof Error && current.cause !== undefined) {
      pending.push(current.cause);
    }
  }
  return found;
}

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
  const plaintextHashKey = await importPlaintextHashTestKey(1);
  const honestHash = await computeDocumentContentRecordPlaintextHash(
    honestSnapshot,
    plaintextHashKey,
  );
  expect(
    await computeDocumentContentRecordPlaintextHash(
      forgedSnapshot,
      plaintextHashKey,
    ),
  ).not.toBe(honestHash);
  await expect(
    assertDocumentUpdatePlaintextHash(
      forgedSnapshot,
      honestHash,
      plaintextHashKey,
    ),
  ).rejects.toThrow("Document update plaintext hash mismatch");
  expect(
    await computeDocumentContentRecordPlaintextHash(
      honestSnapshot,
      await importPlaintextHashTestKey(2),
    ),
  ).not.toBe(honestHash);
});

async function replaceEncryptedPlaintext(input: {
  contentKey: Uint8Array;
  documentId: string;
  organizationId: string;
  update: Awaited<ReturnType<typeof createSyncResponse>>["updates"][number];
}) {
  // Header signature verification is upstream of this unit. Model a writer
  // committing this ciphertext while retaining a hash for different bytes.
  const encrypted = JSON.parse(input.update.encryptedData) as {
    contentKeyEpoch: number;
    contentRecordId: string;
    metadataHash: string;
    nonceDomainHash: string;
  };
  const contentKeyMaterial = await importContentKeyMaterial(input.contentKey);
  const recordKey = await deriveDocumentContentRecordKey({
    contentKeyMaterial,
    contentKeyEpoch: encrypted.contentKeyEpoch,
    contentRecordId: encrypted.contentRecordId,
    documentId: input.documentId,
    organizationId: input.organizationId,
    usage: "encrypt",
  });
  const iv = createAesGcmIv();
  const additionalData = TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain: DOCUMENT_CONTENT_RECORD_AAD_DOMAIN,
      payload: {
        ...documentContentRecordDerivationPayload({
          contentKeyEpoch: encrypted.contentKeyEpoch,
          contentRecordId: encrypted.contentRecordId,
          documentId: input.documentId,
          organizationId: input.organizationId,
        }),
        metadataHash: encrypted.metadataHash,
        nonceDomainHash: encrypted.nonceDomainHash,
      },
    }),
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData },
      recordKey,
      new Uint8Array([1, 2, 3]),
    ),
  );
  const encryptedData = serializeKeyingCanonicalJson({
    format: DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
    version: 1,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentKeyEpoch: encrypted.contentKeyEpoch,
    contentRecordId: encrypted.contentRecordId,
    nonceDomainHash: encrypted.nonceDomainHash,
    metadataHash: encrypted.metadataHash,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  });
  return {
    ...input.update,
    encryptedData,
    writeHeader: {
      ...input.update.writeHeader,
      ciphertextHash:
        await computeDocumentContentRecordCiphertextHash(encryptedData),
    },
  };
}

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
  const responseUpdate = response.updates[0];
  if (!responseUpdate) {
    throw new Error("Expected a response update");
  }

  await expect(
    decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: [
        await replaceEncryptedPlaintext({
          contentKey,
          documentId: materialized.plan.documentId,
          organizationId: materialized.plan.organizationId,
          update: responseUpdate,
        }),
      ],
    }),
  ).rejects.toThrow("Document update plaintext hash mismatch");

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

test("decryptDocumentSyncUpdates identifies a poison update within a valid batch", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const poisonId = "550e8400-e29b-41d4-a716-4466554400aa";
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord(),
      createPendingUpdateRecord({ id: poisonId }),
    ],
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const response = await createSyncResponse(materialized.plan);
  const poisonUpdate = response.updates[1];
  if (!poisonUpdate) throw new Error("Expected a poison response update");

  let isolated: unknown;
  try {
    await decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: [
        response.updates[0] as (typeof response.updates)[number],
        await replaceEncryptedPlaintext({
          contentKey,
          documentId: materialized.plan.documentId,
          organizationId: materialized.plan.organizationId,
          update: poisonUpdate,
        }),
      ],
    });
  } catch (error) {
    isolated = error;
  }

  expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
  if (!isDocumentSyncUpdateIsolationError(isolated)) return;
  expect(isolated.updateId).toBe(poisonId);
  expect(isolated.stage).toBe("plaintext_integrity");
  expect(isolated.writerUserId).toBe(author.signerUserId);
});

test("decryptDocumentSyncUpdates keeps multiple poison updates anonymous", async () => {
  const { author, contentKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const poisonIds = [
    "550e8400-e29b-41d4-a716-4466554400aa",
    "550e8400-e29b-41d4-a716-4466554400ab",
  ];
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: poisonIds.map((id) => createPendingUpdateRecord({ id })),
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const response = await createSyncResponse(materialized.plan);
  const poisonedUpdates = await Promise.all(
    response.updates.map((update) =>
      replaceEncryptedPlaintext({
        contentKey,
        documentId: materialized.plan.documentId,
        organizationId: materialized.plan.organizationId,
        update,
      }),
    ),
  );

  let isolated: unknown;
  try {
    await decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: materialized.plan.contentKeyEpoch,
      documentId: materialized.plan.documentId,
      organizationId: materialized.plan.organizationId,
      updates: poisonedUpdates,
    });
  } catch (error) {
    isolated = error;
  }

  expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
  if (!isDocumentSyncUpdateIsolationError(isolated)) return;
  expect(isolated.attribution).toBe("batch");
  expect(isolated.authorFingerprint).toBeNull();
  expect(isolated.batchUpdateIds).toEqual(poisonIds);
  expect(isolated.stage).toBe("plaintext_integrity");
  expect(isolated.updateId).toBeNull();
  expect(isolated.writerUserId).toBeNull();
  const nestedCauses = errorCauseTree(isolated.cause);
  expect(nestedCauses.some(isDocumentSyncUpdateIsolationError)).toBe(false);
  const nestedMessages = nestedCauses
    .map((cause) => (cause instanceof Error ? cause.message : String(cause)))
    .join("\n");
  expect(nestedMessages).not.toContain(author.signerUserId);
  expect(nestedMessages).not.toContain(
    poisonedUpdates[0]?.authorFingerprint ?? "missing fingerprint",
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
