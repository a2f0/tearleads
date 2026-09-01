import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  attachmentBindings,
  blobContentKeyEpochs,
  blobContentKeyTargets,
  blobContentWriteHeaders,
  blobs,
} from "@tearleads/api-shared/schema";
import {
  type AttachmentBindAccessEventBody,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  type KeyingCanonicalJson,
  signAccessEvent,
  toFingerprint,
  type UnsignedAccessEvent,
  type WriteHeader,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import {
  createRecordingDb,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { resolveCurrentBlobKekTargets } from "../../access/read/blobKekTargets";
import {
  ListDocumentAttachmentsError,
  listDocumentAttachments,
} from "./listDocumentAttachments";

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
    manifestHash: randomHash(),
    organizationId: input.organizationId,
    signerPrivateKey: input.signerPrivateKey,
    signerUserId: input.signerUserId,
  });
}

function randomHash(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createBlob() {
  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: 10,
      sha256: "sha256",
      storageKey: crypto.randomUUID(),
    })
    .returning({ id: blobs.id });

  if (!blob) {
    throw new Error("Failed to create service test blob");
  }

  return blob;
}

async function createBlobContentKeyBundle(input: { blobId: string }) {
  const currentTargets = await resolveCurrentBlobKekTargets(input.blobId, db);
  const [epoch] = await db
    .insert(blobContentKeyEpochs)
    .values({
      blobId: input.blobId,
      contentKeyEpoch: 1,
      targetHash: currentTargets.blobKeyTargetHash,
    })
    .returning({ id: blobContentKeyEpochs.id });
  if (!epoch) {
    throw new Error("Failed to create service test blob content-key epoch");
  }

  const targets = currentTargets.targets.map((target) => ({
    ...target,
    wrappedKey: `wrapped-key:${target.bindingId}:${target.containerId}`,
    wrappingMetadata: { suite: "test-wrap" },
  }));
  await db.insert(blobContentKeyTargets).values(
    targets.map((target) => ({
      blobContentKeyEpochId: epoch.id,
      ...target,
    })),
  );
  const writeHeader: WriteHeader = {
    version: 1,
    accessManifestHash: currentTargets.blobAccessManifestHash,
    ciphertextHash: "sha256",
    contentKeyEpoch: 1,
    contentRecordId: input.blobId,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    metadataHash: "metadata-hash",
    nonceDomainHash: randomHash(),
    objectId: input.blobId,
    objectKind: "blob",
    organizationId: currentTargets.organizationId,
    signature: "signature",
    signedAt: new Date().toISOString(),
    targetHash: currentTargets.blobKeyTargetHash,
    writerDeviceId: "list-attachments-test",
    writerKeyFingerprint: randomHash(),
    writerUserId: crypto.randomUUID(),
  };
  await db.insert(blobContentWriteHeaders).values({
    accessManifestHash: writeHeader.accessManifestHash,
    authorization: currentTargets,
    blobId: input.blobId,
    contentKeyEpoch: writeHeader.contentKeyEpoch,
    contentRecordId: writeHeader.contentRecordId,
    encryptionSuite: writeHeader.encryptionSuite,
    header: writeHeader,
    headerHash: randomHash(),
    nonceDomainHash: writeHeader.nonceDomainHash,
    organizationId: writeHeader.organizationId,
    recordId: input.blobId,
    targetHash: writeHeader.targetHash,
  });

  return {
    blobId: input.blobId,
    contentKeyEpoch: 1,
    targetHash: currentTargets.blobKeyTargetHash,
    targets,
  };
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
    signerPrivateKey: user.signing.signingPrivateKey,
    signerUserId: registration.userId,
  });
  const activeBlob = await createBlob();
  const detachedBlob = await createBlob();
  const bindingId = crypto.randomUUID();
  const bindingBody: AttachmentBindAccessEventBody = {
    bindingId,
    blobId: activeBlob.id,
    documentId: document.id,
    documentManifestHash: document.manifestHash,
    eventType: "attachment.bind",
    expectedBindingId: null,
    slotId: "active-slot",
  };
  const unsignedBindingEvent: UnsignedAccessEvent = {
    bodyHash: await computeAccessEventBodyHash(
      bindingBody as unknown as KeyingCanonicalJson,
    ),
    dependencyManifestHashes: [document.manifestHash],
    eventId: crypto.randomUUID(),
    eventType: "attachment.bind",
    objectId: activeBlob.id,
    objectKind: "blob",
    organizationId: registration.organizationId,
    previousManifestHash: null,
    signedAt: new Date().toISOString(),
    signerDeviceId: "list-attachments-test",
    signerKeyFingerprint: await toFingerprint(user.signing.signingPublicKey),
    signerUserId: registration.userId,
    version: 1,
  };
  const bindingEvent = await signAccessEvent(
    unsignedBindingEvent,
    user.signing.signingPrivateKey,
  );
  const attachmentEventHash = await computeAccessEventHash(bindingEvent);
  await db.insert(accessEvents).values({
    ...bindingEvent,
    body: bindingBody as unknown as KeyingCanonicalJson,
    eventHash: attachmentEventHash,
    signedAt: new Date(bindingEvent.signedAt),
  });
  const [activeBinding] = await db
    .insert(attachmentBindings)
    .values({
      id: bindingId,
      attachmentEventHash,
      blobId: activeBlob.id,
      documentId: document.id,
      documentManifestHash: document.manifestHash,
      slotId: "active-slot",
    })
    .returning({ id: attachmentBindings.id });
  await db.insert(attachmentBindings).values({
    attachmentEventHash: `attachment-event:${detachedBlob.id}`,
    blobId: detachedBlob.id,
    detachedAt: new Date(),
    documentId: document.id,
    documentManifestHash: document.manifestHash,
    slotId: "detached-slot",
  });
  if (!activeBinding) {
    throw new Error("Failed to create service test attachment binding");
  }
  const contentKeyBundle = await createBlobContentKeyBundle({
    blobId: activeBlob.id,
  });

  const recording = createRecordingDb();

  const attachments = await listDocumentAttachments(
    createServiceTestRuntime(recording.db),
    {
      documentId: document.id,
      userId: registration.userId,
    },
  );

  expect(attachments).toHaveLength(1);
  expect(attachments[0]).toMatchObject({
    bindingId: activeBinding.id,
    blobId: activeBlob.id,
    contentKeyBundle,
    documentManifestHash: document.manifestHash,
    previousBindingId: null,
    slotId: "active-slot",
  });
  expect(attachments[0]?.bindingEvent?.eventHash).toBeTruthy();
  expect(attachments[0]?.blobKekTargets?.blobAccessManifestHash).toBeTruthy();
  expect(attachments[0]?.writeHeader).toBeTruthy();
  expect(attachments[0]?.writeAuthorization).toMatchObject({
    blobAccessManifestHash:
      attachments[0]?.blobKekTargets?.blobAccessManifestHash,
    blobKeyTargetHash: contentKeyBundle.targetHash,
  });
  expect(recording.calls.get("select") ?? 0).toBeGreaterThan(0);

  await db
    .update(attachmentBindings)
    .set({ attachmentEventHash: randomHash() })
    .where(eq(attachmentBindings.id, bindingId));
  const damaged = await expectListDocumentAttachmentsError(
    listDocumentAttachments(createServiceTestRuntime(), {
      documentId: document.id,
      userId: registration.userId,
    }),
  );
  expect(damaged.status).toBe(409);
  expect(damaged.message).toBe("Attachment binding event missing");
});

test("listDocumentAttachments reports not-found and forbidden cases", async () => {
  const { registration, user } = await registerServiceUser();
  const other = await registerServiceUser();
  const document = await createReadableDocument({
    containerId: registration.rootContainerId,
    createdByFingerprint: await toFingerprint(user.signing.signingPublicKey),
    organizationId: registration.organizationId,
    signerPrivateKey: user.signing.signingPrivateKey,
    signerUserId: registration.userId,
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
