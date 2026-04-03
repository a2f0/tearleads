import { afterAll, beforeAll, expect, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";
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
import { attachmentBindings, blobStages, documentUpdates } from "../../schema";

const alice = createTestUser();

beforeAll(async () => {
  await registerUser(alice);
  await authenticate(alice);
});

afterAll(async () => {
  await del(alice.fingerprint);
});

test("POST /blobs/stage stores a staged encrypted blob for the authenticated user", async () => {
  const response = await stageBlob(
    {
      encryptedBytes: "ZW5jcnlwdGVkLWJ5dGVz",
      byteLength: 15,
      sha256: "sha256-stage-1",
    },
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
  const createDocumentResponse = await createDocument(alice.token);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");

  const stageResponse = await stageBlob(
    {
      encryptedBytes: "ZW5jcnlwdGVkLWF0dGFjaG1lbnQtMQ==",
      byteLength: 22,
      sha256: "sha256-attachment-1",
    },
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

test("POST /documents/:documentId/commit-change rejects Loro references to unbound slots", async () => {
  const createDocumentResponse = await createDocument(alice.token);
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
