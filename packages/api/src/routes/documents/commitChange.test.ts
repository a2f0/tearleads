import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  type EncryptedEnvelope,
  encryptForRecipients,
  generateKemSeedAndKeyPair,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument as createLoroDocument,
  encodeVersionVector,
  encryptLoroUpdate,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { eq } from "drizzle-orm";
import {
  commitDocumentChange,
  createDocument,
  stageBlob,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { createTestUser } from "../../../test/helpers/createTestUser";
import { registerUser } from "../../../test/helpers/registerUser";
import { db } from "../../adapters/postgres";
import { del } from "../../adapters/redis";
import { app } from "../../index";
import {
  attachmentBindings,
  blobStages,
  blobs,
  documentUpdates,
  objectAccessEpochs,
  objectRecipientEnvelopes,
} from "../../schema";

const alice = createTestUser();
const ENCRYPTED_BLOB_FORMAT = "tearleads.blob.v1";

beforeAll(async () => {
  await registerUser(alice);
  await authenticate(alice);
});

afterAll(async () => {
  await del(alice.fingerprint);
});

function serializeBlobEnvelope(envelope: EncryptedEnvelope): string {
  return JSON.stringify({
    format: ENCRYPTED_BLOB_FORMAT,
    iv: bytesToBase64(envelope.iv),
    ciphertext: bytesToBase64(envelope.ciphertext),
    recipients: envelope.recipients.map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
    })),
  });
}

async function createStagedBlobInput(encryptedBytes: string) {
  const encodedBytes = new TextEncoder().encode(encryptedBytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encodedBytes),
  );

  return {
    encryptedBytes,
    byteLength: encodedBytes.byteLength,
    sha256: Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  };
}

async function createEncryptedBlobInput(
  plaintext: string,
  encodedRecipientPublicKeys: string[],
) {
  const envelope = await encryptForRecipients(
    new TextEncoder().encode(plaintext),
    encodedRecipientPublicKeys.map((publicKey) => base64ToBytes(publicKey)),
  );

  return createStagedBlobInput(serializeBlobEnvelope(envelope));
}

async function createEncryptedBlobInputForRecipientKeys(
  plaintext: string,
  recipientPublicKeys: Uint8Array[],
) {
  const envelope = await encryptForRecipients(
    new TextEncoder().encode(plaintext),
    recipientPublicKeys,
  );

  return createStagedBlobInput(serializeBlobEnvelope(envelope));
}

test("POST /blobs/stage rejects mismatched blob digests", async () => {
  const validInput = await createStagedBlobInput("ZW5jcnlwdGVkLWJ5dGVz");
  const response = await stageBlob(
    {
      encryptedBytes: validInput.encryptedBytes,
      byteLength: validInput.byteLength,
      sha256: "not-the-real-digest",
    },
    alice.token,
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Blob sha256 does not match encryptedBytes",
  });
});

test("POST /blobs/stage stores a staged encrypted blob for the authenticated user", async () => {
  const response = await stageBlob(
    await createStagedBlobInput("ZW5jcnlwdGVkLWJ5dGVz"),
    alice.token,
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(typeof body.stageId).toBe("string");
  expect(typeof body.expiresAt).toBe("string");

  const [storedStage] = await db
    .select({
      id: blobStages.id,
      ownerUserId: blobStages.ownerUserId,
    })
    .from(blobStages)
    .where(eq(blobStages.id, body.stageId))
    .limit(1);

  expect(storedStage?.ownerUserId).toBe(alice.userId);
});

test("POST /documents/:documentId/commit-change atomically commits a blob attachment and document update", async () => {
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");

  const stageResponse = await stageBlob(
    await createEncryptedBlobInput(
      "encrypted-attachment-1",
      createdDocument.recipientEncapsulationPublicKeys,
    ),
    alice.token,
  );
  expect(stageResponse.status).toBe(200);
  const stage = await stageResponse.json();

  const doc = await createLoroDocument(alice.fingerprint);
  const startVersion = encodeVersionVector(doc);
  doc.getText("text").update("document with attachment");
  const update = exportUpdatesSince(doc, startVersion);
  const encryptedUpdate = await encryptLoroUpdate(
    update,
    createdDocument.recipientEncapsulationPublicKeys.map((publicKey: string) =>
      base64ToBytes(publicKey),
    ),
  );
  const vectors = getUpdateVersionVectors(update);

  const response = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [
        {
          slotId: "slot_01",
          stageId: stage.stageId,
          expectedBindingId: null,
        },
      ],
      attachmentDetaches: [],
      loroUpdate: {
        id: crypto.randomUUID(),
        encryptedData: encryptedUpdate,
        partialStartVersionVector: vectors.partialStartVersionVector,
        partialEndVersionVector: vectors.partialEndVersionVector,
        referencedSlotIds: ["slot_01"],
      },
    },
    alice.token,
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.currentAccessEpoch).toBe(createdDocument.currentAccessEpoch);
  expect(body.acceptedOutgoingUpdateIds).toHaveLength(1);
  expect(body.committedBindings).toHaveLength(1);
  expect(body.detachedBindingIds).toEqual([]);

  const [binding] = await db
    .select({
      id: attachmentBindings.id,
      slotId: attachmentBindings.slotId,
      blobId: attachmentBindings.blobId,
      detachedAt: attachmentBindings.detachedAt,
    })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.id, body.committedBindings[0].bindingId))
    .limit(1);
  expect(binding?.slotId).toBe("slot_01");
  expect(binding?.blobId).toBe(body.committedBindings[0].blobId);
  expect(binding?.detachedAt).toBeNull();

  const [storedUpdate] = await db
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.id, body.acceptedOutgoingUpdateIds[0]))
    .limit(1);
  expect(storedUpdate?.id).toBe(body.acceptedOutgoingUpdateIds[0]);

  const [deletedStage] = await db
    .select({ id: blobStages.id })
    .from(blobStages)
    .where(eq(blobStages.id, stage.stageId))
    .limit(1);
  expect(deletedStage).toBeUndefined();
});

test("POST /documents/:documentId/commit-change rejects blob recipients that do not match document access", async () => {
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");
  const unrelatedRecipient = generateKemSeedAndKeyPair();

  const stageResponse = await stageBlob(
    await createEncryptedBlobInputForRecipientKeys("wrong-recipient-blob", [
      unrelatedRecipient.publicKey,
    ]),
    alice.token,
  );
  expect(stageResponse.status).toBe(200);
  const stage = await stageResponse.json();

  const response = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [
        {
          slotId: "slot_mismatch",
          stageId: stage.stageId,
          expectedBindingId: null,
        },
      ],
      attachmentDetaches: [],
      loroUpdate: null,
    },
    alice.token,
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Encrypted blob recipients mismatch",
  });
});

test("POST /documents/:documentId/commit-change rejects Loro references to unbound slots", async () => {
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");

  const doc = await createLoroDocument(alice.fingerprint);
  const startVersion = encodeVersionVector(doc);
  doc.getText("text").update("document with missing attachment reference");
  const update = exportUpdatesSince(doc, startVersion);
  const encryptedUpdate = await encryptLoroUpdate(
    update,
    createdDocument.recipientEncapsulationPublicKeys.map((publicKey: string) =>
      base64ToBytes(publicKey),
    ),
  );
  const vectors = getUpdateVersionVectors(update);

  const response = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [],
      attachmentDetaches: [],
      loroUpdate: {
        id: crypto.randomUUID(),
        encryptedData: encryptedUpdate,
        partialStartVersionVector: vectors.partialStartVersionVector,
        partialEndVersionVector: vectors.partialEndVersionVector,
        referencedSlotIds: ["slot_missing"],
      },
    },
    alice.token,
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Loro update references slot slot_missing without an active binding",
  });
});

test("POST /documents/:documentId/commit-change allows a new update to reference existing slots plus a new slot", async () => {
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");

  const firstStageResponse = await stageBlob(
    await createEncryptedBlobInput(
      "encrypted-attachment-first",
      createdDocument.recipientEncapsulationPublicKeys,
    ),
    alice.token,
  );
  expect(firstStageResponse.status).toBe(200);
  const firstStage = await firstStageResponse.json();

  const firstDoc = await createLoroDocument(alice.fingerprint);
  const firstStartVersion = encodeVersionVector(firstDoc);
  firstDoc.getText("text").update("first attachment");
  const firstUpdate = exportUpdatesSince(firstDoc, firstStartVersion);
  const firstEncryptedUpdate = await encryptLoroUpdate(
    firstUpdate,
    createdDocument.recipientEncapsulationPublicKeys.map((publicKey: string) =>
      base64ToBytes(publicKey),
    ),
  );
  const firstVectors = getUpdateVersionVectors(firstUpdate);

  const firstCommitResponse = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [
        {
          slotId: "slot_01",
          stageId: firstStage.stageId,
          expectedBindingId: null,
        },
      ],
      attachmentDetaches: [],
      loroUpdate: {
        id: crypto.randomUUID(),
        encryptedData: firstEncryptedUpdate,
        partialStartVersionVector: firstVectors.partialStartVersionVector,
        partialEndVersionVector: firstVectors.partialEndVersionVector,
        referencedSlotIds: ["slot_01"],
      },
    },
    alice.token,
  );
  expect(firstCommitResponse.status).toBe(200);

  const secondStageResponse = await stageBlob(
    await createEncryptedBlobInput(
      "encrypted-attachment-second",
      createdDocument.recipientEncapsulationPublicKeys,
    ),
    alice.token,
  );
  expect(secondStageResponse.status).toBe(200);
  const secondStage = await secondStageResponse.json();

  const secondStartVersion = encodeVersionVector(firstDoc);
  firstDoc.getText("text").update("first attachment and second attachment");
  const secondUpdate = exportUpdatesSince(firstDoc, secondStartVersion);
  const secondEncryptedUpdate = await encryptLoroUpdate(
    secondUpdate,
    createdDocument.recipientEncapsulationPublicKeys.map((publicKey: string) =>
      base64ToBytes(publicKey),
    ),
  );
  const secondVectors = getUpdateVersionVectors(secondUpdate);

  const secondCommitResponse = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [
        {
          slotId: "slot_02",
          stageId: secondStage.stageId,
          expectedBindingId: null,
        },
      ],
      attachmentDetaches: [],
      loroUpdate: {
        id: crypto.randomUUID(),
        encryptedData: secondEncryptedUpdate,
        partialStartVersionVector: secondVectors.partialStartVersionVector,
        partialEndVersionVector: secondVectors.partialEndVersionVector,
        referencedSlotIds: ["slot_01", "slot_02"],
      },
    },
    alice.token,
  );

  expect(secondCommitResponse.status).toBe(200);
  const secondBody = await secondCommitResponse.json();
  expect(secondBody.committedBindings).toHaveLength(1);

  const attachmentsResponse = await app.request(
    `/documents/${documentId}/attachments`,
    {
      headers: {
        Authorization: `Bearer ${alice.token}`,
      },
      method: "GET",
    },
  );
  expect(attachmentsResponse.status).toBe(200);
  const attachmentsBody = await attachmentsResponse.json();
  expect(attachmentsBody).toHaveLength(2);
  expect(attachmentsBody).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        blobId: secondBody.committedBindings[0].blobId,
        slotId: "slot_02",
      }),
      expect.objectContaining({
        slotId: "slot_01",
      }),
    ]),
  );
});

test("GET /blobs/:blobId returns committed encrypted blob bytes for readable blobs", async () => {
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");
  const stagedBlobInput = await createEncryptedBlobInput(
    "encrypted-image-bytes",
    createdDocument.recipientEncapsulationPublicKeys,
  );

  const stageResponse = await stageBlob(stagedBlobInput, alice.token);
  expect(stageResponse.status).toBe(200);
  const stage = await stageResponse.json();

  const commitResponse = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [
        {
          slotId: "slot_image",
          stageId: stage.stageId,
          expectedBindingId: null,
        },
      ],
      attachmentDetaches: [],
      loroUpdate: null,
    },
    alice.token,
  );
  expect(commitResponse.status).toBe(200);
  const commitBody = await commitResponse.json();
  const blobId = String(commitBody.committedBindings[0]?.blobId ?? "");

  const blobResponse = await app.request(`/blobs/${blobId}`, {
    headers: {
      Authorization: `Bearer ${alice.token}`,
    },
    method: "GET",
  });

  expect(blobResponse.status).toBe(200);
  expect(await blobResponse.json()).toEqual({
    blobId,
    encryptedBytes: stagedBlobInput.encryptedBytes,
    sha256: stagedBlobInput.sha256,
  });
});

test("POST /documents/:documentId/commit-change deletes the replaced blob when a slot is rebound", async () => {
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");

  const firstStageResponse = await stageBlob(
    await createEncryptedBlobInput(
      "first-encrypted-image",
      createdDocument.recipientEncapsulationPublicKeys,
    ),
    alice.token,
  );
  expect(firstStageResponse.status).toBe(200);
  const firstStage = await firstStageResponse.json();

  const firstCommitResponse = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [
        {
          slotId: "slot_replace",
          stageId: firstStage.stageId,
          expectedBindingId: null,
        },
      ],
      attachmentDetaches: [],
      loroUpdate: null,
    },
    alice.token,
  );
  expect(firstCommitResponse.status).toBe(200);
  const firstCommitBody = await firstCommitResponse.json();
  const firstBlobId = String(
    firstCommitBody.committedBindings[0]?.blobId ?? "",
  );
  const firstBindingId = String(
    firstCommitBody.committedBindings[0]?.bindingId ?? "",
  );

  const secondStageResponse = await stageBlob(
    await createEncryptedBlobInput(
      "second-encrypted-image",
      createdDocument.recipientEncapsulationPublicKeys,
    ),
    alice.token,
  );
  expect(secondStageResponse.status).toBe(200);
  const secondStage = await secondStageResponse.json();

  const secondCommitResponse = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [
        {
          slotId: "slot_replace",
          stageId: secondStage.stageId,
          expectedBindingId: firstBindingId,
        },
      ],
      attachmentDetaches: [],
      loroUpdate: null,
    },
    alice.token,
  );
  expect(secondCommitResponse.status).toBe(200);
  const secondCommitBody = await secondCommitResponse.json();
  const secondBlobId = String(
    secondCommitBody.committedBindings[0]?.blobId ?? "",
  );

  expect(secondBlobId).not.toBe(firstBlobId);

  const [deletedBlob] = await db
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, firstBlobId))
    .limit(1);
  expect(deletedBlob).toBeUndefined();

  const [deletedBlobEpoch] = await db
    .select({ id: objectAccessEpochs.id })
    .from(objectAccessEpochs)
    .where(eq(objectAccessEpochs.objectId, firstBlobId))
    .limit(1);
  expect(deletedBlobEpoch).toBeUndefined();

  const [deletedBlobEnvelope] = await db
    .select({ id: objectRecipientEnvelopes.id })
    .from(objectRecipientEnvelopes)
    .where(eq(objectRecipientEnvelopes.objectId, firstBlobId))
    .limit(1);
  expect(deletedBlobEnvelope).toBeUndefined();

  const staleBlobResponse = await app.request(`/blobs/${firstBlobId}`, {
    headers: {
      Authorization: `Bearer ${alice.token}`,
    },
    method: "GET",
  });
  expect(staleBlobResponse.status).toBe(404);
});
