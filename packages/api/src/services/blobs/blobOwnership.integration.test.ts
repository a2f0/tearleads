import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { attachmentBindings, blobs } from "@symcrypt/api-shared/schema";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import type {
  AttachmentBindAccessEventBody,
  AttachmentDetachAccessEventBody,
  KeyingCanonicalJson,
  VerifiedAttachmentBinding,
  VerifiedBlobKekTargets,
  VerifiedDocumentLinkSetManifest,
} from "@symcrypt/crypto";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeKeyingDomainHash,
  deriveBlobKekTargets,
  signWriteHeader,
  verifyAttachmentBindingEvent,
} from "@symcrypt/crypto";
import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
} from "@symcrypt/validators/request";
import type { DocumentCreateResponse } from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { blobObjectBytes } from "../../../test/helpers/blobObjectStore";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
  createSignedAccessEvent,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { bindBlobAttachment, detachBlobAttachment } from "./blobMutations";
import {
  completeMultipartBlobStage,
  initiateMultipartBlobStage,
  uploadMultipartBlobPartBytes,
} from "./multipartStage";

const runtime = createServiceTestRuntime();

function documentManifest(
  document: DocumentCreateResponse,
): VerifiedDocumentLinkSetManifest {
  return document.accessManifest as unknown as VerifiedDocumentLinkSetManifest;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function stageBlob(owner: TestUser) {
  const encryptedBytes = `encrypted:${crypto.randomUUID()}`;
  const byteLength = new TextEncoder().encode(encryptedBytes).byteLength;
  const sha256 = await sha256Hex(encryptedBytes);
  const staged = await initiateMultipartBlobStage(runtime, {
    byteLength,
    sha256,
    userId: owner.userId,
  });
  const part = await uploadMultipartBlobPartBytes(runtime, {
    byteLength,
    bytes: blobObjectBytes(encryptedBytes),
    partNumber: 1,
    sha256,
    stageId: staged.stageId,
    uploadId: staged.uploadId,
    userId: owner.userId,
  });
  await completeMultipartBlobStage(runtime, {
    parts: [{ etag: part.part.etag, partNumber: 1 }],
    stageId: staged.stageId,
    uploadId: staged.uploadId,
    userId: owner.userId,
  });
  return { sha256, stageId: staged.stageId };
}

async function buildBind(input: {
  readonly blobId: string;
  readonly document: DocumentCreateResponse;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
  readonly stagedBlob?: Awaited<ReturnType<typeof stageBlob>>;
}): Promise<{
  readonly binding: VerifiedAttachmentBinding;
  readonly request: BlobAttachmentBindRequest;
}> {
  const manifest = documentManifest(input.document);
  const containerManifest = asVerifiedContainerManifest(input.root.bundle);
  const body: AttachmentBindAccessEventBody = {
    bindingId: crypto.randomUUID(),
    blobId: input.blobId,
    documentId: manifest.state.documentId,
    documentManifestHash: manifest.manifestHash,
    eventType: "attachment.bind",
    expectedBindingId: null,
    slotId: "ownership-regression",
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      manifest.manifestHash,
      containerManifest.manifestHash,
    ],
    objectId: input.blobId,
    objectKind: "blob",
    organizationId: manifest.state.organizationId,
    previousManifestHash: null,
    signer: input.owner,
  });
  const bindingResult = await verifyAttachmentBindingEvent({
    authorizingContainerPaths: [[containerManifest]],
    body: body as unknown as KeyingCanonicalJson,
    documentManifest: manifest,
    event: event.event,
    expectedPreviousBindingId: null,
    principalPolicies: input.root.principalPolicies,
    signerPublicKey: input.owner.signing.signingPublicKey,
  });
  expect(bindingResult.ok).toBe(true);
  if (!bindingResult.ok) {
    throw bindingResult.error;
  }

  const targetsResult = await deriveBlobKekTargets({
    activeBindings: [bindingResult.value],
    blobId: input.blobId,
    containerKekStates: [input.root.kekState],
    documentManifests: [manifest],
    linkedContainerManifests: [containerManifest],
  });
  expect(targetsResult.ok).toBe(true);
  if (!targetsResult.ok) {
    throw targetsResult.error;
  }

  const request: BlobAttachmentBindRequest = {
    authorizingContainerPathRefs: [
      [
        {
          containerId: containerManifest.state.containerId,
          manifestHash: containerManifest.manifestHash,
        },
      ],
    ],
    body,
    contentKeyBundle: {
      contentKeyEpoch: 1,
      targetHash: targetsResult.value.blobKeyTargetHash,
      targets: contentKeyTargets(targetsResult.value),
    },
    event: event.event as unknown as Record<string, unknown>,
  };
  if (input.stagedBlob) {
    request.stagedBlob = {
      stageId: input.stagedBlob.stageId,
      writeHeader: (await createWriteHeader({
        blobId: input.blobId,
        owner: input.owner,
        sha256: input.stagedBlob.sha256,
        targets: targetsResult.value,
      })) as unknown as Record<string, unknown>,
    };
  }
  return { binding: bindingResult.value, request };
}

function contentKeyTargets(
  targets: VerifiedBlobKekTargets,
): BlobAttachmentBindRequest["contentKeyBundle"]["targets"] {
  return targets.targets.map((target) => ({
    ...target,
    wrappedKey: `wrapped:${target.bindingId}:${target.containerId}`,
    wrappingMetadata: { suite: "test-wrap" },
  }));
}

async function createWriteHeader(input: {
  readonly blobId: string;
  readonly owner: TestUser;
  readonly sha256: string;
  readonly targets: VerifiedBlobKekTargets;
}) {
  return signWriteHeader(
    {
      version: 1,
      organizationId: input.targets.organizationId,
      objectKind: "blob",
      objectId: input.blobId,
      accessManifestHash: input.targets.blobAccessManifestHash,
      contentKeyEpoch: 1,
      targetHash: input.targets.blobKeyTargetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId: input.blobId,
      nonceDomainHash: await computeContentRecordNonceDomainHash({
        version: 1,
        organizationId: input.targets.organizationId,
        objectKind: "blob",
        objectId: input.blobId,
        contentKeyEpoch: 1,
        encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
        contentRecordId: input.blobId,
      }),
      metadataHash: await computeKeyingDomainHash(
        "symcrypt.keying.access-event-body",
        { blobId: input.blobId, purpose: "ownership-regression" },
      ),
      ciphertextHash: input.sha256,
      writerUserId: input.owner.userId,
      writerDeviceId: "ownership-regression",
      writerKeyFingerprint: input.owner.fingerprint,
      signedAt: "2026-08-22T12:00:00.000Z",
    },
    input.owner.signing.signingPrivateKey,
  );
}

async function buildDetach(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly document: DocumentCreateResponse;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<BlobAttachmentDetachRequest> {
  const manifest = documentManifest(input.document);
  const containerManifest = asVerifiedContainerManifest(input.root.bundle);
  const body: AttachmentDetachAccessEventBody = {
    bindingId: input.binding.bindingId,
    blobId: input.binding.blobId,
    documentId: input.binding.documentId,
    documentManifestHash: manifest.manifestHash,
    eventType: "attachment.detach",
    slotId: input.binding.slotId,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      manifest.manifestHash,
      containerManifest.manifestHash,
    ],
    objectId: input.binding.blobId,
    objectKind: "blob",
    organizationId: manifest.state.organizationId,
    previousManifestHash: null,
    signer: input.owner,
  });
  return {
    authorizingContainerPathRefs: [
      [
        {
          containerId: containerManifest.state.containerId,
          manifestHash: containerManifest.manifestHash,
        },
      ],
    ],
    body,
    event: event.event as unknown as Record<string, unknown>,
  };
}

test("a cross-organization bind cannot revive a dereferenced blob", async () => {
  const sourceOwner = createTestUser();
  const targetOwner = createTestUser();
  await registerUser(sourceOwner);
  await registerUser(targetOwner);
  await authenticate(sourceOwner);
  await authenticate(targetOwner);

  const sourceRoot = await bootstrapRoot(sourceOwner);
  const sourceDocument = await createDocument({
    owner: sourceOwner,
    root: sourceRoot,
  });
  const blobId = crypto.randomUUID();
  const sourceBind = await buildBind({
    blobId,
    document: sourceDocument,
    owner: sourceOwner,
    root: sourceRoot,
    stagedBlob: await stageBlob(sourceOwner),
  });
  await bindBlobAttachment(runtime, {
    blobId,
    fingerprint: sourceOwner.fingerprint,
    request: sourceBind.request,
    sessionId: "source-session",
    userId: sourceOwner.userId,
  });
  await detachBlobAttachment(runtime, {
    bindingId: sourceBind.binding.bindingId,
    blobId,
    fingerprint: sourceOwner.fingerprint,
    request: await buildDetach({
      binding: sourceBind.binding,
      document: sourceDocument,
      owner: sourceOwner,
      root: sourceRoot,
    }),
    sessionId: "source-session",
    userId: sourceOwner.userId,
  });
  const [before] = await db
    .select({ dereferencedAt: blobs.dereferencedAt })
    .from(blobs)
    .where(eq(blobs.id, blobId));
  expect(before?.dereferencedAt).toBeInstanceOf(Date);

  const targetRoot = await bootstrapRoot(targetOwner);
  const targetDocument = await createDocument({
    owner: targetOwner,
    root: targetRoot,
  });
  const targetBind = await buildBind({
    blobId,
    document: targetDocument,
    owner: targetOwner,
    root: targetRoot,
  });
  await expect(
    bindBlobAttachment(runtime, {
      blobId,
      fingerprint: targetOwner.fingerprint,
      request: targetBind.request,
      sessionId: "target-session",
      userId: targetOwner.userId,
    }),
  ).rejects.toMatchObject({ message: "Blob not found", status: 404 });

  const [after] = await db
    .select({ dereferencedAt: blobs.dereferencedAt })
    .from(blobs)
    .where(eq(blobs.id, blobId));
  const targetBindings = await db
    .select({ id: attachmentBindings.id })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.documentId, targetDocument.id));
  expect(after?.dereferencedAt?.getTime()).toBe(
    before?.dereferencedAt?.getTime(),
  );
  expect(targetBindings).toEqual([]);
});
