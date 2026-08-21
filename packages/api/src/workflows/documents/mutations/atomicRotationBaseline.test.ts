import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { documents, documentUpdates } from "@symcrypt/api-shared/schema";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeDocumentContentRecordMetadataHash,
  type WriteHeader,
} from "@symcrypt/crypto";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
} from "@symcrypt/loro";
import type { DocumentOutgoingUpdate } from "@symcrypt/validators/request";
import {
  assertAtomicRotationBaselineCoversCommittedFrontier,
  assertBaselinelessUnlinkHasEmptyCommittedFrontier,
} from "./atomicRotationBaseline";

async function rotationBaseline(input: {
  documentId: string;
  sourceVersionVector: string;
}): Promise<DocumentOutgoingUpdate> {
  const id = crypto.randomUUID();
  const partialStartVersionVector = emptyVersionVector();
  const plaintextHash = `plaintext-${id}`;
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    checkpointKind: "rotate_baseline",
    checkpointPayloadKind: "full_history_snapshot",
    documentId: input.documentId,
    partialEndVersionVector: input.sourceVersionVector,
    partialStartVersionVector,
    plaintextHash,
    sourceVersionVector: input.sourceVersionVector,
    updateId: id,
  });
  const header: WriteHeader = {
    version: 1,
    organizationId: crypto.randomUUID(),
    objectKind: "document",
    objectId: input.documentId,
    accessManifestHash: "rotation-manifest",
    contentKeyEpoch: 2,
    targetHash: "rotation-target",
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: id,
    nonceDomainHash: "rotation-nonce-domain",
    metadataHash,
    ciphertextHash: "rotation-ciphertext-hash",
    writerUserId: crypto.randomUUID(),
    writerDeviceId: crypto.randomUUID(),
    writerKeyFingerprint: "rotation-writer-fingerprint",
    signedAt: new Date().toISOString(),
    signature: "rotation-signature",
  };
  return {
    checkpointKind: "rotate_baseline",
    checkpointPayloadKind: "full_history_snapshot",
    id,
    encryptedData: "encrypted-rotation-baseline",
    partialStartVersionVector,
    partialEndVersionVector: input.sourceVersionVector,
    plaintextHash,
    sourceVersionVector: input.sourceVersionVector,
    writeHeader: { ...header },
  };
}

test("atomic rotation baseline must cover the complete committed frontier", async () => {
  const documentId = crypto.randomUUID();
  await db.insert(documents).values({
    id: documentId,
    createdByFingerprint: "atomic-rotation-frontier-test",
  });

  const document = await createDocument("atomic-rotation-frontier-peer");
  document.getText("text").update("first");
  document.commit();
  const staleFrontier = encodeVersionVector(document);
  document.getText("text").update("first second");
  document.commit();
  const committedFrontier = encodeVersionVector(document);
  await db.insert(documentUpdates).values({
    id: crypto.randomUUID(),
    documentId,
    accessEpoch: 1,
    authorFingerprint: "pre-rotation-writer",
    encryptedData: "encrypted-pre-rotation-update",
    byteLength: 29,
    partialStartVersionVector: emptyVersionVector(),
    partialEndVersionVector: committedFrontier,
    plaintextHash: "pre-rotation-plaintext-hash",
  });

  await expect(
    assertAtomicRotationBaselineCoversCommittedFrontier(db, {
      baseline: await rotationBaseline({
        documentId,
        sourceVersionVector: staleFrontier,
      }),
      documentId,
    }),
  ).rejects.toMatchObject({
    message: "Document unlink rotation baseline is stale",
    status: 409,
  });

  await expect(
    assertAtomicRotationBaselineCoversCommittedFrontier(db, {
      baseline: await rotationBaseline({
        documentId,
        sourceVersionVector: committedFrontier,
      }),
      documentId,
    }),
  ).resolves.toBeUndefined();
});

test("baseline-less unlink is allowed only for an empty committed frontier", async () => {
  const documentId = crypto.randomUUID();
  await db.insert(documents).values({
    id: documentId,
    createdByFingerprint: "baselineless-unlink-test",
  });

  await expect(
    assertBaselinelessUnlinkHasEmptyCommittedFrontier(db, { documentId }),
  ).resolves.toBeUndefined();

  const document = await createDocument("baselineless-unlink-peer");
  document.getText("text").update("committed content");
  document.commit();
  await db.insert(documentUpdates).values({
    id: crypto.randomUUID(),
    documentId,
    accessEpoch: 1,
    authorFingerprint: "baselineless-unlink-writer",
    encryptedData: "encrypted-committed-update",
    byteLength: 17,
    partialStartVersionVector: emptyVersionVector(),
    partialEndVersionVector: encodeVersionVector(document),
    plaintextHash: "committed-plaintext-hash",
  });

  await expect(
    assertBaselinelessUnlinkHasEmptyCommittedFrontier(db, { documentId }),
  ).rejects.toMatchObject({
    message:
      "Document unlink requires a rotation baseline covering committed updates",
    status: 409,
  });
});

test("atomic rotation baseline rejects unauthenticated checkpoint metadata", async () => {
  const documentId = crypto.randomUUID();
  await db.insert(documents).values({
    id: documentId,
    createdByFingerprint: "atomic-rotation-auth-test",
  });
  const baseline = await rotationBaseline({
    documentId,
    sourceVersionVector: emptyVersionVector(),
  });
  baseline.writeHeader = { ...baseline.writeHeader, metadataHash: "tampered" };

  await expect(
    assertAtomicRotationBaselineCoversCommittedFrontier(db, {
      baseline,
      documentId,
    }),
  ).rejects.toMatchObject({
    message: "Document unlink rotation baseline is not replayable",
    status: 400,
  });
});
