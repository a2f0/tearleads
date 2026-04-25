import { afterAll, beforeAll, expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  decryptAsRecipient,
  encryptForRecipients,
  generateKemSeedAndKeyPair,
  parseBlobEnvelope,
  parseBlobEnvelopeHeader,
  serializeBlobEnvelope,
  unwrapDek,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument as createLoroDocument,
  derivePeerId,
  encodeVersionVector,
  encryptLoroUpdate,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { DOCUMENT_RECIPIENT_ENVELOPES_CONFLICT_MESSAGE } from "@tearleads/loro/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  commitDocumentChange,
  createContainer as createContainerRequest,
  createDocument,
  stageBlob,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { grantRootContainerWriteAccessToUser } from "../../../test/helpers/grantContainerAccess";
import { registerUser } from "../../../test/helpers/registerUser";
import { attachBlobToDocument } from "../../access/blobAccess";
import { db } from "../../adapters/postgres";
import { del } from "../../adapters/redis";
import { routeApp } from "../../routeApp";
import {
  attachmentBindings,
  blobAuditObjects,
  blobStages,
  blobs,
  containers,
  documentAttachmentAuditEvents,
  documentAuditCheckpoints,
  documentAuditEntries,
  documentUpdateSpans,
  documentUpdates,
  objectAccessEpochs,
  objectRecipientEnvelopes,
  users,
} from "../../schema";

const alice = createTestUser();

beforeAll(async () => {
  await registerUser(alice);
  await authenticate(alice);
});

afterAll(async () => {
  await del(alice.fingerprint);
});

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

async function createDocumentEncryption(
  encodedRecipientPublicKeys: string[],
): Promise<{
  documentKey: Uint8Array;
  documentRecipientEnvelopes: Array<{
    keyFingerprint: string;
    kemCipherText: string;
    wrappedKey: string;
  }>;
}> {
  const documentKey = crypto.getRandomValues(new Uint8Array(32));
  const wrappedRecipients = await wrapDekForRecipients(
    documentKey,
    encodedRecipientPublicKeys.map((publicKey) => base64ToBytes(publicKey)),
  );

  return {
    documentKey,
    documentRecipientEnvelopes: wrappedRecipients.map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
    })),
  };
}

async function readDocumentEncryption(
  documentRecipientEnvelopes: Array<{
    keyFingerprint: string;
    kemCipherText: string;
    wrappedKey: string;
  }>,
): Promise<{
  documentKey: Uint8Array;
  documentRecipientEnvelopes: Array<{
    keyFingerprint: string;
    kemCipherText: string;
    wrappedKey: string;
  }>;
}> {
  return {
    documentKey: await unwrapDek(
      documentRecipientEnvelopes.map((recipient) => ({
        keyFingerprint: recipient.keyFingerprint,
        kemCipherText: base64ToBytes(recipient.kemCipherText),
        wrappedKey: base64ToBytes(recipient.wrappedKey),
      })),
      alice.kem.secretKey,
    ),
    documentRecipientEnvelopes,
  };
}

async function createRewrappedBlobRecipientEnvelopes(
  encryptedBytes: string,
  recipientPublicKeys: Uint8Array[],
  secretKey: Uint8Array,
): Promise<
  Array<{
    keyFingerprint: string;
    kemCipherText: string;
    wrappedKey: string;
  }>
> {
  const header = parseBlobEnvelopeHeader(encryptedBytes);
  const blobKey = await unwrapDek(
    header.recipients.map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: base64ToBytes(recipient.kemCipherText),
      wrappedKey: base64ToBytes(recipient.wrappedKey),
    })),
    secretKey,
  );
  const wrappedRecipients = await wrapDekForRecipients(
    blobKey,
    recipientPublicKeys,
  );

  return wrappedRecipients.map((recipient) => ({
    keyFingerprint: recipient.keyFingerprint,
    kemCipherText: bytesToBase64(recipient.kemCipherText),
    wrappedKey: bytesToBase64(recipient.wrappedKey),
  }));
}

async function getRootContainerIdForUser(userId: string): Promise<string> {
  const [user] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new Error("Expected user row");
  }

  const [rootContainer] = await db
    .select({
      id: containers.id,
    })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, user.defaultOrganizationId),
        isNull(containers.parentId),
      ),
    )
    .limit(1);

  if (!rootContainer) {
    throw new Error("Expected root container row");
  }

  return rootContainer.id;
}

async function listDocumentAttachmentAuditRows(documentId: string) {
  return db
    .select({
      action: documentAttachmentAuditEvents.action,
      bindingId: documentAttachmentAuditEvents.bindingId,
      blobId: documentAttachmentAuditEvents.blobId,
      entryHash: documentAuditEntries.entryHash,
      eventType: documentAuditEntries.eventType,
      previousBindingId: documentAttachmentAuditEvents.previousBindingId,
      previousBlobId: documentAttachmentAuditEvents.previousBlobId,
      prevEntryHash: documentAuditEntries.prevEntryHash,
      sequence: documentAuditEntries.sequence,
      slotId: documentAttachmentAuditEvents.slotId,
    })
    .from(documentAuditEntries)
    .innerJoin(
      documentAttachmentAuditEvents,
      eq(documentAttachmentAuditEvents.auditEntryId, documentAuditEntries.id),
    )
    .where(eq(documentAuditEntries.documentId, documentId))
    .orderBy(documentAuditEntries.sequence);
}

async function createContainerForUser(input: {
  id: string;
  parentId: string;
  token: string;
}): Promise<void> {
  const response = await createContainerRequest(
    {
      id: input.id,
      parentId: input.parentId,
    },
    input.token,
  );

  expect(response.status).toBe(200);
}

async function shareContainerWithUser(input: {
  accessLevel: "read" | "write" | "admin";
  containerId: string;
  subjectId: string;
  token: string;
}): Promise<void> {
  const response = await routeApp.request(
    `/containers/${input.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accessLevel: input.accessLevel,
        expectedAccessStateHash: (
          await (
            await routeApp.request("/containers", {
              method: "GET",
              headers: {
                Authorization: `Bearer ${input.token}`,
              },
            })
          ).json()
        ).find(
          (container: { id?: string }) => container.id === input.containerId,
        )?.metadataAccessStateHash,
        subjectId: input.subjectId,
        subjectType: "user",
      }),
    },
  );

  expect(response.status).toBe(200);
}

async function unlinkDocumentFromContainer(input: {
  containerId: string;
  documentId: string;
  token: string;
}): Promise<{
  currentAccessEpoch: number;
  recipientEncapsulationPublicKeys: string[];
}> {
  const response = await routeApp.request(
    `/documents/${input.documentId}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        containerId: input.containerId,
        expectedAccessStateHash: (
          await (
            await routeApp.request(
              `/containers/${input.containerId}/documents`,
              {
                method: "GET",
                headers: {
                  Authorization: `Bearer ${input.token}`,
                },
              },
            )
          ).json()
        ).find((document: { id?: string }) => document.id === input.documentId)
          ?.currentAccessStateHash,
      }),
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("currentAccessEpoch" in body) ||
    typeof body.currentAccessEpoch !== "number" ||
    !("recipientEncapsulationPublicKeys" in body) ||
    !Array.isArray(body.recipientEncapsulationPublicKeys) ||
    !body.recipientEncapsulationPublicKeys.every(
      (entry: unknown) => typeof entry === "string",
    )
  ) {
    throw new Error(
      "Expected unlinked document response with currentAccessEpoch",
    );
  }

  return {
    currentAccessEpoch: body.currentAccessEpoch,
    recipientEncapsulationPublicKeys: body.recipientEncapsulationPublicKeys,
  };
}

async function expectAttachmentBlobPruned(input: {
  bindingIds: string[];
  blobId: string;
}) {
  const [deletedBlob] = await db
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, input.blobId))
    .limit(1);
  expect(deletedBlob).toBeUndefined();

  const [deletedBlobEpoch] = await db
    .select({ id: objectAccessEpochs.id })
    .from(objectAccessEpochs)
    .where(
      and(
        eq(objectAccessEpochs.objectType, "blob"),
        eq(objectAccessEpochs.objectId, input.blobId),
      ),
    )
    .limit(1);
  expect(deletedBlobEpoch).toBeUndefined();

  const [deletedBlobEnvelope] = await db
    .select({ id: objectRecipientEnvelopes.id })
    .from(objectRecipientEnvelopes)
    .where(
      and(
        eq(objectRecipientEnvelopes.objectType, "blob"),
        eq(objectRecipientEnvelopes.objectId, input.blobId),
      ),
    )
    .limit(1);
  expect(deletedBlobEnvelope).toBeUndefined();

  for (const bindingId of input.bindingIds) {
    const [deletedBinding] = await db
      .select({ id: attachmentBindings.id })
      .from(attachmentBindings)
      .where(eq(attachmentBindings.id, bindingId))
      .limit(1);
    expect(deletedBinding).toBeUndefined();
  }
}

test("POST /documents/:documentId/commit-change atomically commits a blob attachment and document update", async () => {
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");
  const { documentKey, documentRecipientEnvelopes } =
    await readDocumentEncryption(createdDocument.documentRecipientEnvelopes);

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
    createdDocument.currentAccessEpoch,
    documentKey,
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
      attachmentRewraps: [],
      documentRecipientEnvelopes,
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

  const storedSpans = await db
    .select({
      endCounter: documentUpdateSpans.endCounter,
      peerId: documentUpdateSpans.peerId,
      startCounter: documentUpdateSpans.startCounter,
    })
    .from(documentUpdateSpans)
    .where(eq(documentUpdateSpans.updateId, body.acceptedOutgoingUpdateIds[0]))
    .limit(1);
  expect(storedSpans).toHaveLength(1);
  expect(storedSpans[0]?.peerId).toBe(await derivePeerId(alice.fingerprint));
  expect(storedSpans[0]?.startCounter).toBe(0);
  expect(storedSpans[0]?.endCounter).toBeGreaterThan(0);

  const [deletedStage] = await db
    .select({ id: blobStages.id })
    .from(blobStages)
    .where(eq(blobStages.id, stage.stageId))
    .limit(1);
  expect(deletedStage).toBeUndefined();
});

test("POST /documents/:documentId/commit-change rejects a stale access state hash", async () => {
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();

  const response = await commitDocumentChange(
    String(createdDocument.id ?? ""),
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      expectedAccessStateHash: "stale-access-state-hash",
      attachmentCommits: [],
      attachmentDetaches: [],
      attachmentRewraps: [],
      loroUpdate: null,
    },
    alice.token,
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "Stale access state hash" });
});

test("POST /documents/:documentId/commit-change rejects a divergent current-epoch document bundle", async () => {
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");
  const canonicalDocumentEncryption = await readDocumentEncryption(
    createdDocument.documentRecipientEnvelopes,
  );
  const divergentDocumentEncryption = await createDocumentEncryption(
    createdDocument.recipientEncapsulationPublicKeys,
  );

  const doc = await createLoroDocument(alice.fingerprint);
  const startVersion = encodeVersionVector(doc);
  doc.getText("text").update("divergent current-epoch bundle");
  const update = exportUpdatesSince(doc, startVersion);
  const encryptedUpdate = await encryptLoroUpdate(
    update,
    createdDocument.currentAccessEpoch,
    divergentDocumentEncryption.documentKey,
  );
  const vectors = getUpdateVersionVectors(update);

  const response = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [],
      attachmentDetaches: [],
      attachmentRewraps: [],
      documentRecipientEnvelopes:
        divergentDocumentEncryption.documentRecipientEnvelopes,
      loroUpdate: {
        id: crypto.randomUUID(),
        encryptedData: encryptedUpdate,
        partialStartVersionVector: vectors.partialStartVersionVector,
        partialEndVersionVector: vectors.partialEndVersionVector,
        referencedSlotIds: [],
      },
    },
    alice.token,
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: DOCUMENT_RECIPIENT_ENVELOPES_CONFLICT_MESSAGE,
  });

  const storedUpdateRows = await db
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, documentId));
  expect(storedUpdateRows).toHaveLength(0);

  const storedRecipientRows = await db
    .select({
      keyFingerprint: objectRecipientEnvelopes.recipientKeyFingerprint,
      kemCipherText: objectRecipientEnvelopes.kemCipherText,
      wrappedKey: objectRecipientEnvelopes.wrappedKey,
    })
    .from(objectRecipientEnvelopes)
    .where(
      and(
        eq(objectRecipientEnvelopes.objectType, "document"),
        eq(objectRecipientEnvelopes.objectId, documentId),
        eq(objectRecipientEnvelopes.epoch, createdDocument.currentAccessEpoch),
      ),
    );
  expect(
    storedRecipientRows.sort((left, right) =>
      left.keyFingerprint.localeCompare(right.keyFingerprint),
    ),
  ).toEqual(canonicalDocumentEncryption.documentRecipientEnvelopes);
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
      attachmentRewraps: [],
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
  const { documentKey, documentRecipientEnvelopes } =
    await readDocumentEncryption(createdDocument.documentRecipientEnvelopes);

  const doc = await createLoroDocument(alice.fingerprint);
  const startVersion = encodeVersionVector(doc);
  doc.getText("text").update("document with missing attachment reference");
  const update = exportUpdatesSince(doc, startVersion);
  const encryptedUpdate = await encryptLoroUpdate(
    update,
    createdDocument.currentAccessEpoch,
    documentKey,
  );
  const vectors = getUpdateVersionVectors(update);

  const response = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [],
      attachmentDetaches: [],
      attachmentRewraps: [],
      documentRecipientEnvelopes,
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
  const { documentKey, documentRecipientEnvelopes } =
    await readDocumentEncryption(createdDocument.documentRecipientEnvelopes);

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
    createdDocument.currentAccessEpoch,
    documentKey,
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
      attachmentRewraps: [],
      documentRecipientEnvelopes,
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
    createdDocument.currentAccessEpoch,
    documentKey,
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
      attachmentRewraps: [],
      documentRecipientEnvelopes,
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

  const attachmentsResponse = await routeApp.request(
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

test("POST /documents/:documentId/commit-change rewraps an existing blob without creating a new blob row", async () => {
  const bob = createTestUser();
  await registerUser(bob);
  await authenticate(bob);

  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");
  const stagedBlobInput = await createEncryptedBlobInput(
    "blob-bytes-before-share",
    createdDocument.recipientEncapsulationPublicKeys,
  );

  const stageResponse = await stageBlob(stagedBlobInput, alice.token);
  expect(stageResponse.status).toBe(200);
  const stage = await stageResponse.json();

  const firstCommitResponse = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [
        {
          slotId: "slot_rewrap",
          stageId: stage.stageId,
          expectedBindingId: null,
        },
      ],
      attachmentDetaches: [],
      attachmentRewraps: [],
      loroUpdate: null,
    },
    alice.token,
  );
  expect(firstCommitResponse.status).toBe(200);
  const firstCommitBody = await firstCommitResponse.json();
  const blobId = String(firstCommitBody.committedBindings[0]?.blobId ?? "");
  const bindingId = String(
    firstCommitBody.committedBindings[0]?.bindingId ?? "",
  );

  const sharedAccessEpoch = await grantRootContainerWriteAccessToUser(
    alice.userId,
    bob.userId,
  );
  expect(sharedAccessEpoch).toBeGreaterThan(createdDocument.currentAccessEpoch);

  const rewrappedBlobRecipients = await createRewrappedBlobRecipientEnvelopes(
    stagedBlobInput.encryptedBytes,
    [alice.kem.publicKey, bob.kem.publicKey],
    alice.kem.secretKey,
  );
  const rewrapResponse = await commitDocumentChange(
    documentId,
    {
      accessEpoch: sharedAccessEpoch,
      attachmentCommits: [],
      attachmentDetaches: [],
      attachmentRewraps: [
        {
          slotId: "slot_rewrap",
          expectedBindingId: bindingId,
          recipientEnvelopes: rewrappedBlobRecipients,
        },
      ],
      loroUpdate: null,
    },
    alice.token,
  );
  expect(rewrapResponse.status).toBe(200);
  expect((await rewrapResponse.json()).committedBindings).toEqual([]);

  const blobResponse = await routeApp.request(`/blobs/${blobId}`, {
    headers: {
      Authorization: `Bearer ${bob.token}`,
    },
    method: "GET",
  });
  expect(blobResponse.status).toBe(200);
  const blobBody = await blobResponse.json();
  const parsedEnvelope = parseBlobEnvelope(blobBody.encryptedBytes);
  expect(
    parsedEnvelope.recipients
      .map((recipient) => recipient.keyFingerprint)
      .sort(),
  ).toEqual(
    rewrappedBlobRecipients.map((recipient) => recipient.keyFingerprint).sort(),
  );
  expect(
    new TextDecoder().decode(
      await decryptAsRecipient(parsedEnvelope, bob.kem.secretKey),
    ),
  ).toBe("blob-bytes-before-share");

  const [storedBlob] = await db
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, blobId))
    .limit(1);
  expect(storedBlob?.id).toBe(blobId);

  const [blobAuditRow] = await db
    .select({
      blobId: blobAuditObjects.blobId,
      historicalBytesRetained: blobAuditObjects.historicalBytesRetained,
      liveStorageKey: blobAuditObjects.liveStorageKey,
      prunedAt: blobAuditObjects.prunedAt,
      retentionMode: blobAuditObjects.retentionMode,
    })
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, blobId))
    .limit(1);
  expect(blobAuditRow).toEqual({
    blobId,
    historicalBytesRetained: false,
    liveStorageKey: String(stage.stageId ?? ""),
    prunedAt: null,
    retentionMode: "live_only",
  });

  const attachmentAuditRows = await listDocumentAttachmentAuditRows(documentId);
  expect(attachmentAuditRows).toHaveLength(2);
  expect(attachmentAuditRows[0]).toEqual({
    action: "attach",
    bindingId,
    blobId,
    entryHash: expect.any(String),
    eventType: "attachment_event",
    previousBindingId: null,
    previousBlobId: null,
    prevEntryHash: null,
    sequence: expect.any(Number),
    slotId: "slot_rewrap",
  });
  expect(attachmentAuditRows[1]).toEqual({
    action: "rewrap",
    bindingId,
    blobId,
    entryHash: expect.any(String),
    eventType: "attachment_event",
    previousBindingId: null,
    previousBlobId: null,
    prevEntryHash: attachmentAuditRows[0]?.entryHash ?? null,
    sequence: expect.any(Number),
    slotId: "slot_rewrap",
  });
});

test("POST /documents/:documentId/commit-change rejects blob rewraps after recipient shrink requires rotation", async () => {
  const bob = createTestUser();
  await registerUser(bob);
  await authenticate(bob);
  const carol = createTestUser();
  await registerUser(carol);
  await authenticate(carol);

  const rootContainerId = await getRootContainerIdForUser(alice.userId);
  const bobContainerId = crypto.randomUUID();
  const carolContainerId = crypto.randomUUID();
  await createContainerForUser({
    id: bobContainerId,
    parentId: rootContainerId,
    token: alice.token,
  });
  await createContainerForUser({
    id: carolContainerId,
    parentId: rootContainerId,
    token: alice.token,
  });
  await shareContainerWithUser({
    accessLevel: "write",
    containerId: bobContainerId,
    subjectId: bob.userId,
    token: alice.token,
  });
  await shareContainerWithUser({
    accessLevel: "write",
    containerId: carolContainerId,
    subjectId: carol.userId,
    token: alice.token,
  });

  const createDocumentResponse = await createDocument(alice.token, [
    rootContainerId,
    bobContainerId,
    carolContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");
  const stagedBlobInput = await createEncryptedBlobInput(
    "blob-bytes-before-shrink",
    createdDocument.recipientEncapsulationPublicKeys,
  );

  const stageResponse = await stageBlob(stagedBlobInput, alice.token);
  expect(stageResponse.status).toBe(200);
  const stage = await stageResponse.json();

  const firstCommitResponse = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [
        {
          slotId: "slot_rotate",
          stageId: stage.stageId,
          expectedBindingId: null,
        },
      ],
      attachmentDetaches: [],
      attachmentRewraps: [],
      loroUpdate: null,
    },
    alice.token,
  );
  expect(firstCommitResponse.status).toBe(200);
  const firstCommitBody = await firstCommitResponse.json();
  const bindingId = String(
    firstCommitBody.committedBindings[0]?.bindingId ?? "",
  );

  const unlinkedDocument = await unlinkDocumentFromContainer({
    containerId: carolContainerId,
    documentId,
    token: alice.token,
  });
  const shrunkRewrapRecipients = await createRewrappedBlobRecipientEnvelopes(
    stagedBlobInput.encryptedBytes,
    unlinkedDocument.recipientEncapsulationPublicKeys.map((publicKey) =>
      base64ToBytes(publicKey),
    ),
    alice.kem.secretKey,
  );
  const rotateRewrapResponse = await commitDocumentChange(
    documentId,
    {
      accessEpoch: unlinkedDocument.currentAccessEpoch,
      attachmentCommits: [],
      attachmentDetaches: [],
      attachmentRewraps: [
        {
          slotId: "slot_rotate",
          expectedBindingId: bindingId,
          recipientEnvelopes: shrunkRewrapRecipients,
        },
      ],
      loroUpdate: null,
    },
    alice.token,
  );
  const rotateRewrapBody = await rotateRewrapResponse.json();
  expect({
    body: rotateRewrapBody,
    status: rotateRewrapResponse.status,
  }).toEqual({
    body: {
      error:
        "Blob recipient envelopes require blob replacement after access shrink",
    },
    status: 409,
  });
});

test("POST /documents/:documentId/commit-change requires rotate baseline source frontier", async () => {
  const bob = createTestUser();
  await registerUser(bob);
  await authenticate(bob);

  const bobContainerId = crypto.randomUUID();
  await createContainerForUser({
    id: bobContainerId,
    parentId: alice.rootContainerId,
    token: alice.token,
  });
  await shareContainerWithUser({
    accessLevel: "write",
    containerId: bobContainerId,
    subjectId: bob.userId,
    token: alice.token,
  });

  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
    bobContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");
  const initialDocumentEncryption = await readDocumentEncryption(
    createdDocument.documentRecipientEnvelopes,
  );

  const loroDoc = await createLoroDocument(
    `${alice.fingerprint}-commit-rotate-source`,
  );
  const initialVersion = encodeVersionVector(loroDoc);
  loroDoc.getText("text").update("commit before unlink");
  const initialUpdate = exportUpdatesSince(loroDoc, initialVersion);
  const initialVectors = getUpdateVersionVectors(initialUpdate);
  const initialCommitResponse = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [],
      attachmentDetaches: [],
      attachmentRewraps: [],
      loroUpdate: {
        id: crypto.randomUUID(),
        encryptedData: await encryptLoroUpdate(
          initialUpdate,
          createdDocument.currentAccessEpoch,
          initialDocumentEncryption.documentKey,
        ),
        partialStartVersionVector: initialVectors.partialStartVersionVector,
        partialEndVersionVector: initialVectors.partialEndVersionVector,
        referencedSlotIds: [],
      },
    },
    alice.token,
  );
  expect(initialCommitResponse.status).toBe(200);

  const unlinkedDocument = await unlinkDocumentFromContainer({
    containerId: bobContainerId,
    documentId,
    token: alice.token,
  });
  expect(unlinkedDocument.currentAccessEpoch).toBeGreaterThan(
    createdDocument.currentAccessEpoch,
  );

  const rotatedDocumentEncryption = await createDocumentEncryption(
    unlinkedDocument.recipientEncapsulationPublicKeys,
  );
  const baselineUpdate = exportUpdatesSince(loroDoc, null);
  const baselineVectors = getUpdateVersionVectors(baselineUpdate);
  const encryptedBaseline = await encryptLoroUpdate(
    baselineUpdate,
    unlinkedDocument.currentAccessEpoch,
    rotatedDocumentEncryption.documentKey,
  );
  const baseCommitInput = {
    accessEpoch: unlinkedDocument.currentAccessEpoch,
    attachmentCommits: [],
    attachmentDetaches: [],
    attachmentRewraps: [],
    documentRecipientEnvelopes:
      rotatedDocumentEncryption.documentRecipientEnvelopes,
  };

  const missingSourceResponse = await commitDocumentChange(
    documentId,
    {
      ...baseCommitInput,
      loroUpdate: {
        checkpointKind: "rotate_baseline",
        id: crypto.randomUUID(),
        encryptedData: encryptedBaseline,
        partialStartVersionVector: baselineVectors.partialStartVersionVector,
        partialEndVersionVector: baselineVectors.partialEndVersionVector,
        referencedSlotIds: [],
      },
    },
    alice.token,
  );
  expect(missingSourceResponse.status).toBe(400);
  expect(await missingSourceResponse.json()).toEqual({
    error: "Missing rotate baseline source version vector",
  });

  const staleSourceResponse = await commitDocumentChange(
    documentId,
    {
      ...baseCommitInput,
      loroUpdate: {
        checkpointKind: "rotate_baseline",
        id: crypto.randomUUID(),
        encryptedData: encryptedBaseline,
        partialStartVersionVector: baselineVectors.partialStartVersionVector,
        partialEndVersionVector: baselineVectors.partialEndVersionVector,
        referencedSlotIds: [],
        sourceVersionVector: initialVectors.partialStartVersionVector,
      },
    },
    alice.token,
  );
  expect(staleSourceResponse.status).toBe(409);
  expect(await staleSourceResponse.json()).toEqual({
    error: "Stale rotate baseline source version vector",
  });

  const sourceOmittingBaselineResponse = await commitDocumentChange(
    documentId,
    {
      ...baseCommitInput,
      loroUpdate: {
        checkpointKind: "rotate_baseline",
        id: crypto.randomUUID(),
        encryptedData: encryptedBaseline,
        partialStartVersionVector: baselineVectors.partialStartVersionVector,
        partialEndVersionVector: initialVectors.partialStartVersionVector,
        referencedSlotIds: [],
        sourceVersionVector: initialVectors.partialEndVersionVector,
      },
    },
    alice.token,
  );
  expect(sourceOmittingBaselineResponse.status).toBe(409);
  expect(await sourceOmittingBaselineResponse.json()).toEqual({
    error: "Rotate baseline frontier does not cover all prior-epoch updates",
  });

  const acceptedRotateUpdateId = crypto.randomUUID();
  const acceptedRotateResponse = await commitDocumentChange(
    documentId,
    {
      ...baseCommitInput,
      loroUpdate: {
        checkpointKind: "rotate_baseline",
        id: acceptedRotateUpdateId,
        encryptedData: encryptedBaseline,
        partialStartVersionVector: baselineVectors.partialStartVersionVector,
        partialEndVersionVector: baselineVectors.partialEndVersionVector,
        referencedSlotIds: [],
        sourceVersionVector: initialVectors.partialEndVersionVector,
      },
    },
    alice.token,
  );
  expect(acceptedRotateResponse.status).toBe(200);
  const acceptedRotate = await acceptedRotateResponse.json();
  expect(acceptedRotate.acceptedOutgoingUpdateIds).toHaveLength(1);
  expect(acceptedRotate.currentAccessEpoch).toBe(
    unlinkedDocument.currentAccessEpoch,
  );
  expect(acceptedRotate.documentRecipientEnvelopes).toEqual(
    rotatedDocumentEncryption.documentRecipientEnvelopes,
  );

  const [checkpointRow] = await db
    .select({
      accessEpoch: documentAuditCheckpoints.accessEpoch,
      actorFingerprint: documentAuditCheckpoints.actorFingerprint,
      actorUserId: documentAuditCheckpoints.actorUserId,
      baselineUpdateId: documentAuditCheckpoints.baselineUpdateId,
      checkpointKind: documentAuditCheckpoints.checkpointKind,
      sourceVersionVector: documentAuditCheckpoints.sourceVersionVector,
    })
    .from(documentAuditCheckpoints)
    .where(
      eq(documentAuditCheckpoints.baselineUpdateId, acceptedRotateUpdateId),
    )
    .limit(1);
  expect(checkpointRow).toEqual({
    accessEpoch: unlinkedDocument.currentAccessEpoch,
    actorFingerprint: alice.fingerprint,
    actorUserId: alice.userId,
    baselineUpdateId: acceptedRotateUpdateId,
    checkpointKind: "rotate_baseline",
    sourceVersionVector: initialVectors.partialEndVersionVector,
  });
});

test("POST /documents/:documentId/commit-change prunes a detached blob with no active bindings", async () => {
  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");

  const stageResponse = await stageBlob(
    await createEncryptedBlobInput(
      "detach-only-encrypted-image",
      createdDocument.recipientEncapsulationPublicKeys,
    ),
    alice.token,
  );
  expect(stageResponse.status).toBe(200);
  const stage = await stageResponse.json();

  const firstCommitResponse = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [
        {
          slotId: "slot_detach",
          stageId: stage.stageId,
          expectedBindingId: null,
        },
      ],
      attachmentDetaches: [],
      attachmentRewraps: [],
      loroUpdate: null,
    },
    alice.token,
  );
  expect(firstCommitResponse.status).toBe(200);
  const firstCommitBody = await firstCommitResponse.json();
  const blobId = String(firstCommitBody.committedBindings[0]?.blobId ?? "");
  const bindingId = String(
    firstCommitBody.committedBindings[0]?.bindingId ?? "",
  );

  const detachResponse = await commitDocumentChange(
    documentId,
    {
      accessEpoch: createdDocument.currentAccessEpoch,
      attachmentCommits: [],
      attachmentDetaches: [
        {
          slotId: "slot_detach",
          expectedBindingId: bindingId,
        },
      ],
      attachmentRewraps: [],
      loroUpdate: null,
    },
    alice.token,
  );
  expect(detachResponse.status).toBe(200);
  const detachBody = await detachResponse.json();
  expect(detachBody.committedBindings).toEqual([]);
  expect(detachBody.detachedBindingIds).toEqual([bindingId]);

  await expectAttachmentBlobPruned({
    bindingIds: [bindingId],
    blobId,
  });

  const [blobAuditRow] = await db
    .select({
      blobId: blobAuditObjects.blobId,
      byteLength: blobAuditObjects.byteLength,
      historicalBytesRetained: blobAuditObjects.historicalBytesRetained,
      liveStorageKey: blobAuditObjects.liveStorageKey,
      prunedAt: blobAuditObjects.prunedAt,
      retentionMode: blobAuditObjects.retentionMode,
      sha256: blobAuditObjects.sha256,
    })
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, blobId))
    .limit(1);
  expect(blobAuditRow).toEqual({
    blobId,
    byteLength: expect.any(Number),
    historicalBytesRetained: false,
    liveStorageKey: null,
    prunedAt: expect.any(Date),
    retentionMode: "live_only",
    sha256: expect.any(String),
  });

  const attachmentAuditRows = await listDocumentAttachmentAuditRows(documentId);
  expect(attachmentAuditRows).toHaveLength(2);
  expect(attachmentAuditRows[0]).toEqual({
    action: "attach",
    bindingId,
    blobId,
    entryHash: expect.any(String),
    eventType: "attachment_event",
    previousBindingId: null,
    previousBlobId: null,
    prevEntryHash: null,
    sequence: expect.any(Number),
    slotId: "slot_detach",
  });
  expect(attachmentAuditRows[1]).toEqual({
    action: "detach",
    bindingId,
    blobId,
    entryHash: expect.any(String),
    eventType: "attachment_event",
    previousBindingId: null,
    previousBlobId: null,
    prevEntryHash: attachmentAuditRows[0]?.entryHash ?? null,
    sequence: expect.any(Number),
    slotId: "slot_detach",
  });

  const staleBlobResponse = await routeApp.request(`/blobs/${blobId}`, {
    headers: {
      Authorization: `Bearer ${alice.token}`,
    },
    method: "GET",
  });
  expect(staleBlobResponse.status).toBe(404);
});

test("POST /documents/:documentId/commit-change retains a detached blob while another active binding references it", async () => {
  const firstDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(firstDocumentResponse.status).toBe(200);
  const firstDocument = await firstDocumentResponse.json();
  const firstDocumentId = String(firstDocument.id ?? "");

  const secondDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(secondDocumentResponse.status).toBe(200);
  const secondDocument = await secondDocumentResponse.json();
  const secondDocumentId = String(secondDocument.id ?? "");

  const stageResponse = await stageBlob(
    await createEncryptedBlobInput(
      "shared-encrypted-image",
      firstDocument.recipientEncapsulationPublicKeys,
    ),
    alice.token,
  );
  expect(stageResponse.status).toBe(200);
  const stage = await stageResponse.json();

  const firstCommitResponse = await commitDocumentChange(
    firstDocumentId,
    {
      accessEpoch: firstDocument.currentAccessEpoch,
      attachmentCommits: [
        {
          slotId: "slot_shared_first",
          stageId: stage.stageId,
          expectedBindingId: null,
        },
      ],
      attachmentDetaches: [],
      attachmentRewraps: [],
      loroUpdate: null,
    },
    alice.token,
  );
  expect(firstCommitResponse.status).toBe(200);
  const firstCommitBody = await firstCommitResponse.json();
  const blobId = String(firstCommitBody.committedBindings[0]?.blobId ?? "");
  const firstBindingId = String(
    firstCommitBody.committedBindings[0]?.bindingId ?? "",
  );

  await attachBlobToDocument(blobId, secondDocumentId, "slot_shared_second");
  const [secondBinding] = await db
    .select({
      id: attachmentBindings.id,
      detachedAt: attachmentBindings.detachedAt,
    })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.documentId, secondDocumentId),
        eq(attachmentBindings.slotId, "slot_shared_second"),
        isNull(attachmentBindings.detachedAt),
      ),
    )
    .limit(1);
  const secondBindingId = String(secondBinding?.id ?? "");
  expect(secondBindingId).not.toBe("");

  const firstDetachResponse = await commitDocumentChange(
    firstDocumentId,
    {
      accessEpoch: firstDocument.currentAccessEpoch,
      attachmentCommits: [],
      attachmentDetaches: [
        {
          slotId: "slot_shared_first",
          expectedBindingId: firstBindingId,
        },
      ],
      attachmentRewraps: [],
      loroUpdate: null,
    },
    alice.token,
  );
  expect(firstDetachResponse.status).toBe(200);
  expect((await firstDetachResponse.json()).detachedBindingIds).toEqual([
    firstBindingId,
  ]);

  const [retainedBlob] = await db
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, blobId))
    .limit(1);
  expect(retainedBlob?.id).toBe(blobId);

  const [firstDetachedBinding] = await db
    .select({
      detachedAt: attachmentBindings.detachedAt,
      id: attachmentBindings.id,
    })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.id, firstBindingId))
    .limit(1);
  expect(firstDetachedBinding?.id).toBe(firstBindingId);
  expect(firstDetachedBinding?.detachedAt).toBeInstanceOf(Date);

  const [secondActiveBinding] = await db
    .select({
      detachedAt: attachmentBindings.detachedAt,
      id: attachmentBindings.id,
    })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.id, secondBindingId))
    .limit(1);
  expect(secondActiveBinding?.id).toBe(secondBindingId);
  expect(secondActiveBinding?.detachedAt).toBeNull();

  const retainedBlobResponse = await routeApp.request(`/blobs/${blobId}`, {
    headers: {
      Authorization: `Bearer ${alice.token}`,
    },
    method: "GET",
  });
  expect(retainedBlobResponse.status).toBe(200);

  const secondDetachResponse = await commitDocumentChange(
    secondDocumentId,
    {
      accessEpoch: secondDocument.currentAccessEpoch,
      attachmentCommits: [],
      attachmentDetaches: [
        {
          slotId: "slot_shared_second",
          expectedBindingId: secondBindingId,
        },
      ],
      attachmentRewraps: [],
      loroUpdate: null,
    },
    alice.token,
  );
  expect(secondDetachResponse.status).toBe(200);
  expect((await secondDetachResponse.json()).detachedBindingIds).toEqual([
    secondBindingId,
  ]);

  await expectAttachmentBlobPruned({
    bindingIds: [firstBindingId, secondBindingId],
    blobId,
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
      attachmentRewraps: [],
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
      attachmentRewraps: [],
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

  await expectAttachmentBlobPruned({
    bindingIds: [firstBindingId],
    blobId: firstBlobId,
  });

  const secondBindingId = String(
    secondCommitBody.committedBindings[0]?.bindingId ?? "",
  );
  const [currentBinding] = await db
    .select({
      id: attachmentBindings.id,
      previousBindingId: attachmentBindings.previousBindingId,
    })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.id, secondBindingId))
    .limit(1);
  expect(currentBinding?.id).toBe(secondBindingId);
  expect(currentBinding?.previousBindingId).toBeNull();

  const blobAuditRows = await db
    .select({
      blobId: blobAuditObjects.blobId,
      historicalBytesRetained: blobAuditObjects.historicalBytesRetained,
      liveStorageKey: blobAuditObjects.liveStorageKey,
      prunedAt: blobAuditObjects.prunedAt,
      retentionMode: blobAuditObjects.retentionMode,
    })
    .from(blobAuditObjects)
    .where(inArray(blobAuditObjects.blobId, [firstBlobId, secondBlobId]));
  expect(blobAuditRows).toHaveLength(2);
  expect(blobAuditRows.find((row) => row.blobId === firstBlobId)).toEqual({
    blobId: firstBlobId,
    historicalBytesRetained: false,
    liveStorageKey: null,
    prunedAt: expect.any(Date),
    retentionMode: "live_only",
  });
  expect(blobAuditRows.find((row) => row.blobId === secondBlobId)).toEqual({
    blobId: secondBlobId,
    historicalBytesRetained: false,
    liveStorageKey: String(secondStage.stageId ?? ""),
    prunedAt: null,
    retentionMode: "live_only",
  });

  const attachmentAuditRows = await listDocumentAttachmentAuditRows(documentId);
  expect(attachmentAuditRows).toHaveLength(2);
  expect(attachmentAuditRows[0]).toEqual({
    action: "attach",
    bindingId: firstBindingId,
    blobId: firstBlobId,
    entryHash: expect.any(String),
    eventType: "attachment_event",
    previousBindingId: null,
    previousBlobId: null,
    prevEntryHash: null,
    sequence: expect.any(Number),
    slotId: "slot_replace",
  });
  expect(attachmentAuditRows[1]).toEqual({
    action: "replace",
    bindingId: secondBindingId,
    blobId: secondBlobId,
    entryHash: expect.any(String),
    eventType: "attachment_event",
    previousBindingId: firstBindingId,
    previousBlobId: firstBlobId,
    prevEntryHash: attachmentAuditRows[0]?.entryHash ?? null,
    sequence: expect.any(Number),
    slotId: "slot_replace",
  });

  const staleBlobResponse = await routeApp.request(`/blobs/${firstBlobId}`, {
    headers: {
      Authorization: `Bearer ${alice.token}`,
    },
    method: "GET",
  });
  expect(staleBlobResponse.status).toBe(404);
});
