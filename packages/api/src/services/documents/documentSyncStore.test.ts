import { expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import {
  createDocument,
  derivePeerId,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import { eq } from "drizzle-orm";
import { createTestUser } from "../../../test/helpers/createTestUser";
import {
  createPublicKeyRequest,
  createRecordingDb,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { db } from "../../adapters/postgres";
import {
  documentContainerLinks,
  documentUpdateSpans,
  documentUpdates,
} from "../../schema";
import { registerPublicKey } from "../auth/registerPublicKey";
import {
  CreateDocumentError,
  createDocumentSyncStore,
  DocumentUpdateError,
} from "./documentSyncStore";

async function registerServiceUser() {
  const runtime = createServiceTestRuntime();
  const user = createTestUser();
  const registration = await registerPublicKey(
    runtime,
    await createPublicKeyRequest(user),
  );

  return { registration, user };
}

async function createServiceDocument() {
  const { registration, user } = await registerServiceUser();
  const store = createDocumentSyncStore(createServiceTestRuntime());
  const created = await store.createDocument({
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
    createdByUserId: registration.userId,
    linkedContainerIds: [registration.rootContainerId],
  });

  if (!created) {
    throw new Error("Failed to create service test document");
  }

  return { created, registration, store, user };
}

async function expectCreateDocumentError(
  promise: Promise<unknown>,
): Promise<CreateDocumentError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CreateDocumentError);
    return error as CreateDocumentError;
  }

  throw new Error("Expected createDocument to fail");
}

async function expectDocumentSyncStoreError(
  promise: Promise<unknown>,
): Promise<DocumentUpdateError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentUpdateError);
    return error as DocumentUpdateError;
  }

  throw new Error("Expected document sync store operation to fail");
}

test("document sync store creates documents and resolves access through the runtime database", async () => {
  const { registration, user } = await registerServiceUser();
  const recording = createRecordingDb();
  const store = createDocumentSyncStore(createServiceTestRuntime(recording.db));

  const created = await store.createDocument({
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
    createdByUserId: registration.userId,
    linkedContainerIds: [registration.rootContainerId],
  });

  expect(created?.currentAccessEpoch).toBe(1);
  expect(created?.documentRecipientEnvelopes).toHaveLength(1);
  expect(created?.recipientEncapsulationPublicKeys).toHaveLength(1);
  expect(recording.calls.get("transaction") ?? 0).toBeGreaterThan(0);

  const documentId = String(created?.document.id ?? "");
  const linkedContainer = await db
    .select({ containerId: documentContainerLinks.containerId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, documentId))
    .limit(1);
  expect(linkedContainer[0]?.containerId).toBe(registration.rootContainerId);

  const fetched = await store.getDocumentById(documentId);
  expect(fetched?.id).toBe(documentId);

  const access = await store.getDocumentAccess({
    documentId,
    userId: registration.userId,
  });
  expect(access?.canRead).toBe(true);
  expect(access?.canWrite).toBe(true);
  expect(access?.currentAccessEpoch).toBe(1);
  expect(access?.documentRecipientEnvelopes).toHaveLength(1);
  expect(recording.calls.get("select") ?? 0).toBeGreaterThan(0);
});

test("document sync store appends missing document updates idempotently", async () => {
  const { created, store, user } = await createServiceDocument();
  const peerSeed = "document-sync-store-span-peer";
  const doc = await createDocument(peerSeed);
  const startVersion = encodeVersionVector(doc);
  doc.getText("text").update("service store update");
  const vectors = getUpdateVersionVectors(
    exportUpdatesSince(doc, startVersion),
  );
  const updateId = crypto.randomUUID();
  const update = {
    id: updateId,
    encryptedData: "encrypted-update",
    partialStartVersionVector: vectors.partialStartVersionVector,
    partialEndVersionVector: vectors.partialEndVersionVector,
  };
  const documentRecipientEnvelopes = created.documentRecipientEnvelopes;
  if (!documentRecipientEnvelopes) {
    throw new Error("Expected service test document recipient envelopes");
  }

  const firstAppend = await store.appendDocumentUpdates({
    documentId: created.document.id,
    authorFingerprint: await toFingerprint(user.signing.signingPublicKey),
    documentRecipientEnvelopes,
    updates: [update],
  });
  expect(firstAppend.acceptedOutgoingUpdateIds).toEqual([updateId]);
  expect(firstAppend.commitLsn).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/);
  expect(firstAppend.documentRecipientEnvelopes).toEqual(
    documentRecipientEnvelopes,
  );

  const retryAppend = await store.appendDocumentUpdates({
    documentId: created.document.id,
    authorFingerprint: await toFingerprint(user.signing.signingPublicKey),
    documentRecipientEnvelopes,
    updates: [update],
  });
  expect(retryAppend.acceptedOutgoingUpdateIds).toEqual([updateId]);
  expect(retryAppend.commitLsn).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/);

  const dbRows = await db
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, created.document.id));
  expect(dbRows).toHaveLength(1);

  const spanRows = await db
    .select({
      endCounter: documentUpdateSpans.endCounter,
      peerId: documentUpdateSpans.peerId,
      startCounter: documentUpdateSpans.startCounter,
    })
    .from(documentUpdateSpans)
    .where(eq(documentUpdateSpans.updateId, updateId));
  expect(spanRows).toHaveLength(1);
  expect(spanRows[0]).toEqual({
    endCounter: expect.any(Number),
    peerId: await derivePeerId(peerSeed),
    startCounter: 0,
  });
  expect(spanRows[0]?.endCounter).toBeGreaterThan(0);
});

test("document sync store lists only causally missing document updates", async () => {
  const { created, store, user } = await createServiceDocument();
  const aliceDoc = await createDocument("document-sync-store-missing-alice");
  const aliceStartVersion = encodeVersionVector(aliceDoc);
  aliceDoc.getText("text").update("Hello from Alice");
  const firstUpdate = exportUpdatesSince(aliceDoc, aliceStartVersion);
  const firstVectors = getUpdateVersionVectors(firstUpdate);
  const bobDoc = await createDocument("document-sync-store-missing-bob");
  importUpdates(bobDoc, [firstUpdate]);
  const bobStartVersion = encodeVersionVector(bobDoc);
  bobDoc.getText("text").update("Hello from Alice and Bob");
  const secondUpdate = exportUpdatesSince(bobDoc, bobStartVersion);
  const secondVectors = getUpdateVersionVectors(secondUpdate);
  const documentRecipientEnvelopes = created.documentRecipientEnvelopes;
  if (!documentRecipientEnvelopes) {
    throw new Error("Expected service test document recipient envelopes");
  }

  const authorFingerprint = await toFingerprint(user.signing.signingPublicKey);
  const firstUpdateId = crypto.randomUUID();
  const secondUpdateId = crypto.randomUUID();
  await store.appendDocumentUpdates({
    documentId: created.document.id,
    authorFingerprint,
    documentRecipientEnvelopes,
    updates: [
      {
        id: firstUpdateId,
        encryptedData: "encrypted-first-update",
        partialStartVersionVector: firstVectors.partialStartVersionVector,
        partialEndVersionVector: firstVectors.partialEndVersionVector,
      },
    ],
  });
  await store.appendDocumentUpdates({
    documentId: created.document.id,
    authorFingerprint,
    documentRecipientEnvelopes,
    updates: [
      {
        id: secondUpdateId,
        encryptedData: "encrypted-second-update",
        partialStartVersionVector: secondVectors.partialStartVersionVector,
        partialEndVersionVector: secondVectors.partialEndVersionVector,
      },
    ],
  });

  const allMissing = await store.listMissingDocumentUpdates({
    documentId: created.document.id,
    localVersionVector: null,
  });
  expect(allMissing.map((update) => update.id)).toEqual([
    firstUpdateId,
    secondUpdateId,
  ]);

  const missingAfterFirstUpdate = await store.listMissingDocumentUpdates({
    documentId: created.document.id,
    localVersionVector: encodeVersionVector(aliceDoc),
  });
  expect(missingAfterFirstUpdate.map((update) => update.id)).toEqual([
    secondUpdateId,
  ]);

  const missingAfterSecondUpdate = await store.listMissingDocumentUpdates({
    documentId: created.document.id,
    localVersionVector: encodeVersionVector(bobDoc),
  });
  expect(missingAfterSecondUpdate).toEqual([]);
});

test("document sync store rejects unsatisfied minLsn reads", async () => {
  const { created, store } = await createServiceDocument();

  const error = await expectDocumentSyncStoreError(
    store.listMissingDocumentUpdates({
      documentId: created.document.id,
      localVersionVector: null,
      minLsn: "FFFFFFFF/FFFFFFFF",
    }),
  );
  expect(error.status).toBe(503);
  expect(error.message).toBe(
    "Requested minimum commit LSN has not been reached",
  );
});

test("document sync store reports create and append errors", async () => {
  const { registration, user } = await registerServiceUser();
  const other = await registerServiceUser();
  const store = createDocumentSyncStore(createServiceTestRuntime());

  const duplicateContainers = await expectCreateDocumentError(
    store.createDocument({
      createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
      createdByUserId: registration.userId,
      linkedContainerIds: [
        registration.rootContainerId,
        registration.rootContainerId,
      ],
    }),
  );
  expect(duplicateContainers.status).toBe(400);
  expect(duplicateContainers.message).toBe(
    "linkedContainerIds must not contain duplicates",
  );

  const forbiddenContainer = await expectCreateDocumentError(
    store.createDocument({
      createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
      createdByUserId: other.registration.userId,
      linkedContainerIds: [registration.rootContainerId],
    }),
  );
  expect(forbiddenContainer.status).toBe(403);
  expect(forbiddenContainer.message).toBe("Forbidden");

  const missingDocument = await expectDocumentSyncStoreError(
    store.appendDocumentUpdates({
      documentId: crypto.randomUUID(),
      authorFingerprint: await toFingerprint(user.signing.signingPublicKey),
      updates: [],
    }),
  );
  expect(missingDocument.status).toBe(409);
  expect(missingDocument.message).toBe("Document access state not found");
});
