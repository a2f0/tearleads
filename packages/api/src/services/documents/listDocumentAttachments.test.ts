import { expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import { createTestUser } from "../../../test/helpers/createTestUser";
import {
  createPublicKeyRequest,
  createRecordingDb,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { initializeDocumentAccess } from "../../access/documentAccess";
import { db } from "../../adapters/postgres";
import {
  attachmentBindings,
  blobs,
  documentContainerLinks,
  documents,
} from "../../schema";
import { registerPublicKey } from "../auth/registerPublicKey";
import {
  ListDocumentAttachmentsError,
  listDocumentAttachments,
} from "./listDocumentAttachments";

async function registerServiceUser() {
  const runtime = createServiceTestRuntime();
  const user = createTestUser();
  const registration = await registerPublicKey(
    runtime,
    await createPublicKeyRequest(user),
  );

  return { registration, user };
}

async function createReadableDocument(input: {
  containerId: string;
  createdByFingerprint: string;
}) {
  const [document] = await db
    .insert(documents)
    .values({
      createdByFingerprint: input.createdByFingerprint,
    })
    .returning({ id: documents.id });

  if (!document) {
    throw new Error("Failed to create service test document");
  }

  await db.insert(documentContainerLinks).values({
    containerId: input.containerId,
    documentId: document.id,
  });
  await initializeDocumentAccess(document.id, db);

  return document;
}

async function createBlob() {
  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: 10,
      encryptedBytes: "blob-bytes",
      sha256: "sha256",
      storageKey: crypto.randomUUID(),
    })
    .returning({ id: blobs.id });

  if (!blob) {
    throw new Error("Failed to create service test blob");
  }

  return blob;
}

async function expectListDocumentAttachmentsError(
  promise: Promise<unknown>,
): Promise<ListDocumentAttachmentsError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ListDocumentAttachmentsError);
    return error as ListDocumentAttachmentsError;
  }

  throw new Error("Expected listDocumentAttachments to fail");
}

test("listDocumentAttachments returns active attachment bindings for readable documents", async () => {
  const { registration, user } = await registerServiceUser();
  const document = await createReadableDocument({
    containerId: registration.rootContainerId,
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
  });
  const activeBlob = await createBlob();
  const detachedBlob = await createBlob();
  const [activeBinding] = await db
    .insert(attachmentBindings)
    .values({
      blobId: activeBlob.id,
      documentId: document.id,
      slotId: "active-slot",
    })
    .returning({ id: attachmentBindings.id });
  await db.insert(attachmentBindings).values({
    blobId: detachedBlob.id,
    detachedAt: new Date(),
    documentId: document.id,
    slotId: "detached-slot",
  });
  if (!activeBinding) {
    throw new Error("Failed to create service test attachment binding");
  }

  const recording = createRecordingDb();

  const attachments = await listDocumentAttachments(
    createServiceTestRuntime(recording.db),
    {
      documentId: document.id,
      userId: registration.userId,
    },
  );

  expect(attachments).toEqual([
    {
      bindingId: activeBinding.id,
      blobId: activeBlob.id,
      slotId: "active-slot",
    },
  ]);
  expect(recording.calls.get("select") ?? 0).toBeGreaterThan(0);
});

test("listDocumentAttachments reports not-found and forbidden cases", async () => {
  const { registration, user } = await registerServiceUser();
  const other = await registerServiceUser();
  const document = await createReadableDocument({
    containerId: registration.rootContainerId,
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
  });

  const missing = await expectListDocumentAttachmentsError(
    listDocumentAttachments(createServiceTestRuntime(), {
      documentId: crypto.randomUUID(),
      userId: registration.userId,
    }),
  );
  expect(missing.status).toBe(404);
  expect(missing.message).toBe("Document not found");

  const forbidden = await expectListDocumentAttachmentsError(
    listDocumentAttachments(createServiceTestRuntime(), {
      documentId: document.id,
      userId: other.registration.userId,
    }),
  );
  expect(forbidden.status).toBe(403);
  expect(forbidden.message).toBe("Forbidden");
});
