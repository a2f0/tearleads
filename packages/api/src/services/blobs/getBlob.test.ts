import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { attachmentBindings, blobs } from "@symcrypt/api-shared/schema";
import { toFingerprint } from "@symcrypt/crypto";
import { uploadBlobObject } from "../../../test/helpers/blobObjectStore";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { sha256Hex } from "../../utils/sha256";
import { GetBlobError, getBlobBytes } from "./getBlob";

async function createReadableDocument(input: {
  containerId: string;
  createdByFingerprint: string;
  organizationId: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}) {
  return createCurrentDocumentProjection({
    containerIds: [input.containerId],
    createdByFingerprint: input.createdByFingerprint,
    organizationId: input.organizationId,
    signerPrivateKey: input.signerPrivateKey,
    signerUserId: input.signerUserId,
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

async function expectGetBlobBytesError(
  promise: Promise<unknown>,
): Promise<GetBlobError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GetBlobError);
    return error as GetBlobError;
  }

  throw new Error("Expected getBlobBytes to fail");
}

test("getBlobBytes streams object-store blobs for readable users", async () => {
  const { registration, user } = await registerServiceUser();
  const document = await createReadableDocument({
    containerId: registration.rootContainerId,
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
    organizationId: registration.organizationId,
    signerPrivateKey: user.signing.signingPrivateKey,
    signerUserId: registration.userId,
  });
  const encryptedBytes = "streamed-service-blob-bytes";
  const storageKey = `blob-stages/${crypto.randomUUID()}`;
  const objectStore = createServiceTestRuntime().blobObjectStore;
  const sha256 = await sha256Hex(encryptedBytes);
  await uploadBlobObject(objectStore, storageKey, encryptedBytes);
  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
      sha256,
      storageKey,
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

test("getBlobBytes returns object streams without buffering them", async () => {
  const { registration, user } = await registerServiceUser();
  const document = await createReadableDocument({
    containerId: registration.rootContainerId,
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
    organizationId: registration.organizationId,
    signerPrivateKey: user.signing.signingPrivateKey,
    signerUserId: registration.userId,
  });
  const encryptedBytes = "lazy-streamed-service-blob";
  const storageKey = `blob-stages/${crypto.randomUUID()}`;
  const sha256 = await sha256Hex(encryptedBytes);
  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
      sha256,
      storageKey,
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

test("getBlobBytes reports not-found and forbidden cases", async () => {
  const { registration, user } = await registerServiceUser();
  const other = await registerServiceUser();
  const document = await createReadableDocument({
    containerId: registration.rootContainerId,
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
    organizationId: registration.organizationId,
    signerPrivateKey: user.signing.signingPrivateKey,
    signerUserId: registration.userId,
  });
  const blob = await createCommittedBlob({
    documentId: document.id,
    encryptedBytes: "private-service-blob-bytes",
  });

  const missing = await expectGetBlobBytesError(
    getBlobBytes(createServiceTestRuntime(), {
      blobId: crypto.randomUUID(),
      userId: registration.userId,
    }),
  );
  expect(missing.status).toBe(404);
  expect(missing.message).toBe("Blob not found");

  const forbidden = await expectGetBlobBytesError(
    getBlobBytes(createServiceTestRuntime(), {
      blobId: blob.id,
      userId: other.registration.userId,
    }),
  );
  expect(forbidden.status).toBe(403);
  expect(forbidden.message).toBe("Forbidden");
});
