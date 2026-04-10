import { expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import { emptyVersionVector } from "@tearleads/loro";
import { eq } from "drizzle-orm";
import { createTestUser } from "../../../test/helpers/createTestUser";
import {
  createPublicKeyRequest,
  createRecordingDb,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { db } from "../../adapters/postgres";
import { documentContainerLinks, documentUpdates } from "../../schema";
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

async function expectDocumentUpdateError(
  promise: Promise<unknown>,
): Promise<DocumentUpdateError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentUpdateError);
    return error as DocumentUpdateError;
  }

  throw new Error("Expected appendDocumentUpdates to fail");
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
  const updateId = crypto.randomUUID();
  const update = {
    id: updateId,
    encryptedData: "encrypted-update",
    partialStartVersionVector: emptyVersionVector(),
    partialEndVersionVector: emptyVersionVector(),
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

  const storedUpdates = await store.listDocumentUpdates(created.document.id);
  expect(storedUpdates).toHaveLength(1);
  expect(storedUpdates[0]?.id).toBe(updateId);

  const dbRows = await db
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, created.document.id));
  expect(dbRows).toHaveLength(1);
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

  const missingDocument = await expectDocumentUpdateError(
    store.appendDocumentUpdates({
      documentId: crypto.randomUUID(),
      authorFingerprint: await toFingerprint(user.signing.signingPublicKey),
      updates: [],
    }),
  );
  expect(missingDocument.status).toBe(409);
  expect(missingDocument.message).toBe("Document access state not found");
});
