import { expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import {
  createRecordingDb,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { db } from "../../adapters/postgres";
import { attachmentBindings, blobs } from "../../schema";
import {
  ListDocumentAttachmentsError,
  listDocumentAttachments,
} from "./listDocumentAttachments";

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
    organizationId: registration.organizationId,
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
    organizationId: registration.organizationId,
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
