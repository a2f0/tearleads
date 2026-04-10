import { expect, test } from "bun:test";
import {
  encryptForRecipients,
  serializeBlobEnvelope,
  toFingerprint,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { createTestUser } from "../../../test/helpers/createTestUser";
import {
  createPublicKeyRequest,
  createRecordingDb,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { attachBlobToDocument } from "../../access/blobAccess";
import { initializeDocumentAccess } from "../../access/documentAccess";
import { db } from "../../adapters/postgres";
import { blobs, documentContainerLinks, documents } from "../../schema";
import { sha256Hex } from "../../utils/sha256";
import { registerPublicKey } from "../auth/registerPublicKey";
import { GetBlobError, getBlob } from "./getBlob";

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

async function createCommittedBlob(input: {
  documentId: string;
  encryptedBytes: string;
}) {
  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: new TextEncoder().encode(input.encryptedBytes).byteLength,
      encryptedBytes: input.encryptedBytes,
      sha256: await sha256Hex(input.encryptedBytes),
      storageKey: crypto.randomUUID(),
    })
    .returning({ id: blobs.id });

  if (!blob) {
    throw new Error("Failed to create service test blob");
  }

  await attachBlobToDocument(blob.id, input.documentId, "service-slot");

  return blob;
}

async function createEncryptedBlobBytes(
  plaintext: string,
  encodedRecipientPublicKeys: string[],
): Promise<string> {
  const envelope = await encryptForRecipients(
    new TextEncoder().encode(plaintext),
    encodedRecipientPublicKeys.map((publicKey) => base64ToBytes(publicKey)),
  );

  return serializeBlobEnvelope(envelope);
}

async function expectGetBlobError(
  promise: Promise<unknown>,
): Promise<GetBlobError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GetBlobError);
    return error as GetBlobError;
  }

  throw new Error("Expected getBlob to fail");
}

test("getBlob returns committed blob bytes for readable blobs", async () => {
  const { registration, user } = await registerServiceUser();
  const document = await createReadableDocument({
    containerId: registration.rootContainerId,
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
  });
  const encryptedBytes = await createEncryptedBlobBytes(
    "service-blob-bytes",
    registration.rootMetadataRecipientEncapsulationPublicKeys,
  );
  const blob = await createCommittedBlob({
    documentId: document.id,
    encryptedBytes,
  });
  const recording = createRecordingDb();

  const result = await getBlob(createServiceTestRuntime(recording.db), {
    blobId: blob.id,
    userId: registration.userId,
  });

  expect(result).toEqual({
    blobId: blob.id,
    encryptedBytes,
    sha256: await sha256Hex(encryptedBytes),
  });
  expect(recording.calls.get("select") ?? 0).toBeGreaterThan(0);
});

test("getBlob reports not-found and forbidden cases", async () => {
  const { registration, user } = await registerServiceUser();
  const other = await registerServiceUser();
  const document = await createReadableDocument({
    containerId: registration.rootContainerId,
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
  });
  const blob = await createCommittedBlob({
    documentId: document.id,
    encryptedBytes: "private-service-blob-bytes",
  });

  const missing = await expectGetBlobError(
    getBlob(createServiceTestRuntime(), {
      blobId: crypto.randomUUID(),
      userId: registration.userId,
    }),
  );
  expect(missing.status).toBe(404);
  expect(missing.message).toBe("Blob not found");

  const forbidden = await expectGetBlobError(
    getBlob(createServiceTestRuntime(), {
      blobId: blob.id,
      userId: other.registration.userId,
    }),
  );
  expect(forbidden.status).toBe(403);
  expect(forbidden.message).toBe("Forbidden");
});
