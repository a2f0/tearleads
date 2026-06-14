import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { attachmentBindings, blobs } from "@tearleads/api-shared/schema";
import {
  encryptForRecipients,
  serializeBlobEnvelope,
  toFingerprint,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import {
  createRecordingDb,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { encodeExternalBlobBytesRef } from "../../utils/blobStageRecords";
import { sha256Hex } from "../../utils/sha256";
import { GetBlobError, getBlob, getBlobBytes } from "./getBlob";

async function createReadableDocument(input: {
  containerId: string;
  createdByFingerprint: string;
  organizationId: string;
}) {
  return createCurrentDocumentProjection({
    containerIds: [input.containerId],
    createdByFingerprint: input.createdByFingerprint,
    organizationId: input.organizationId,
  });
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

  await db.insert(attachmentBindings).values({
    blobId: blob.id,
    documentId: input.documentId,
    slotId: "service-slot",
  });

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
    organizationId: registration.organizationId,
  });
  const encryptedBytes = await createEncryptedBlobBytes("service-blob-bytes", [
    bytesToBase64(user.kem.publicKey),
  ]);
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

test("getBlobBytes streams external blob objects for readable blobs", async () => {
  const { registration, user } = await registerServiceUser();
  const document = await createReadableDocument({
    containerId: registration.rootContainerId,
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
    organizationId: registration.organizationId,
  });
  const encryptedBytes = await createEncryptedBlobBytes(
    "streamed-service-blob-bytes",
    [bytesToBase64(user.kem.publicKey)],
  );
  const storageKey = `blob-stages/${crypto.randomUUID()}`;
  const objectStore = createServiceTestRuntime().blobObjectStore;
  const { uploadId } = await objectStore.createMultipartUpload({
    key: storageKey,
  });
  const part = await objectStore.uploadPart({
    body: { bytes: encryptedBytes },
    key: storageKey,
    partNumber: 1,
    uploadId,
  });
  const sha256 = await sha256Hex(encryptedBytes);
  await objectStore.completeMultipartUpload({
    expected: {
      byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
      sha256,
    },
    key: storageKey,
    parts: [{ etag: part.etag, partNumber: 1 }],
    uploadId,
  });
  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
      encryptedBytes: encodeExternalBlobBytesRef({ storageKey }),
      sha256,
      storageKey: crypto.randomUUID(),
    })
    .returning({ id: blobs.id });
  if (!blob) {
    throw new Error("Failed to create streamed service test blob");
  }
  await db.insert(attachmentBindings).values({
    blobId: blob.id,
    documentId: document.id,
    slotId: "streamed-service-slot",
  });
  let streamRead = false;
  const runtime = {
    ...createServiceTestRuntime(),
    blobObjectStore: {
      ...objectStore,
      getObjectStream: async (key: string) => {
        streamRead = true;
        return objectStore.getObjectStream(key);
      },
    },
  };

  const result = await getBlobBytes(runtime, {
    blobId: blob.id,
    userId: registration.userId,
  });

  expect(result.blobId).toBe(blob.id);
  expect(result.byteLength).toBe(
    new TextEncoder().encode(encryptedBytes).byteLength,
  );
  expect(result.sha256).toBe(sha256);
  await expect(new Response(result.encryptedBytes).text()).resolves.toBe(
    encryptedBytes,
  );
  expect(streamRead).toBe(true);
});

test("getBlobBytes returns external streams without buffering them", async () => {
  const { registration, user } = await registerServiceUser();
  const document = await createReadableDocument({
    containerId: registration.rootContainerId,
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
    organizationId: registration.organizationId,
  });
  const encryptedBytes = "lazy-streamed-service-blob";
  const storageKey = `blob-stages/${crypto.randomUUID()}`;
  const sha256 = await sha256Hex(encryptedBytes);
  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
      encryptedBytes: encodeExternalBlobBytesRef({ storageKey }),
      sha256,
      storageKey: crypto.randomUUID(),
    })
    .returning({ id: blobs.id });
  if (!blob) {
    throw new Error("Failed to create lazy streamed service test blob");
  }
  await db.insert(attachmentBindings).values({
    blobId: blob.id,
    documentId: document.id,
    slotId: "lazy-streamed-service-slot",
  });
  let pulls = 0;
  const runtime = {
    ...createServiceTestRuntime(),
    blobObjectStore: {
      ...createServiceTestRuntime().blobObjectStore,
      getObjectStream: async (key: string) => {
        expect(key).toBe(storageKey);

        return new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              pulls += 1;
              controller.enqueue(
                new TextEncoder().encode(
                  pulls === 1 ? "lazy-streamed-" : "service-blob",
                ),
              );
              if (pulls === 2) {
                controller.close();
              }
            },
          },
          { highWaterMark: 0 },
        );
      },
    },
  };

  const result = await getBlobBytes(runtime, {
    blobId: blob.id,
    userId: registration.userId,
  });

  expect(pulls).toBe(0);
  const reader = result.encryptedBytes.getReader();
  const firstChunk = await reader.read();
  expect(new TextDecoder().decode(firstChunk.value)).toBe("lazy-streamed-");
  expect(pulls).toBe(1);
  await reader.cancel();
});

test("getBlob reports not-found and forbidden cases", async () => {
  const { registration, user } = await registerServiceUser();
  const other = await registerServiceUser();
  const document = await createReadableDocument({
    containerId: registration.rootContainerId,
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
    organizationId: registration.organizationId,
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
