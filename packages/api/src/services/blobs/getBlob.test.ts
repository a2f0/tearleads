import { expect, test } from "bun:test";
import {
  encryptForRecipients,
  serializeBlobEnvelope,
  toFingerprint,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { and, eq } from "drizzle-orm";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import {
  createRecordingDb,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { attachBlobToDocument } from "../../access/blobAccess";
import { initializeDocumentAccess } from "../../access/documentAccess";
import { db } from "../../adapters/postgres";
import {
  blobs,
  documentContainerLinks,
  documents,
  objectRecipientEnvelopes,
} from "../../schema";
import { sha256Hex } from "../../utils/sha256";
import { GetBlobError, getBlob } from "./getBlob";

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

async function countBlobRecipientEnvelopes(blobId: string): Promise<number> {
  return (
    await db
      .select({ id: objectRecipientEnvelopes.id })
      .from(objectRecipientEnvelopes)
      .where(
        and(
          eq(objectRecipientEnvelopes.objectType, "blob"),
          eq(objectRecipientEnvelopes.objectId, blobId),
        ),
      )
  ).length;
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
  const encryptedBytes = await createEncryptedBlobBytes("service-blob-bytes", [
    bytesToBase64(user.kem.publicKey),
  ]);
  const blob = await createCommittedBlob({
    documentId: document.id,
    encryptedBytes,
  });
  const recording = createRecordingDb();

  expect(await countBlobRecipientEnvelopes(blob.id)).toBe(0);

  const result = await getBlob(createServiceTestRuntime(recording.db), {
    blobId: blob.id,
    userId: registration.userId,
  });

  expect(result).toEqual({
    blobId: blob.id,
    encryptedBytes,
    sha256: await sha256Hex(encryptedBytes),
  });
  expect(await countBlobRecipientEnvelopes(blob.id)).toBe(0);
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
