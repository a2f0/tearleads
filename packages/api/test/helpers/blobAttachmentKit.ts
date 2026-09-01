import { expect } from "bun:test";
import type { TestUser } from "@tearleads/bob-and-alice";
import type {
  AttachmentBindAccessEventBody,
  AttachmentDetachAccessEventBody,
  KeyingCanonicalJson,
  VerifiedAttachmentBinding,
  VerifiedBlobKekTargets,
  VerifiedDocumentLinkSetManifest,
} from "@tearleads/crypto";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeKeyingDomainHash,
  deriveBlobKekTargets,
  signWriteHeader,
  verifyAttachmentBindingEvent,
} from "@tearleads/crypto";
import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
} from "@tearleads/validators/request";
import type { DocumentCreateResponse } from "@tearleads/validators/response";
import {
  bindBlobAttachment,
  detachBlobAttachment,
} from "../../src/services/blobs/blobMutations";
import {
  completeMultipartBlobStage,
  initiateMultipartBlobStage,
  uploadMultipartBlobPartBytes,
} from "../../src/services/blobs/multipartStage";
import { blobObjectBytes } from "./blobObjectStore";
import {
  asVerifiedContainerManifest,
  createSignedAccessEvent,
  type StoredRootFixture,
} from "./keyingWriterProjectionKit";
import { createServiceTestRuntime } from "./serviceRuntime";

const blobAttachmentTestRuntime = createServiceTestRuntime();

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

export async function stageBlob(owner: TestUser) {
  const encryptedBytes = `encrypted:${crypto.randomUUID()}`;
  const byteLength = new TextEncoder().encode(encryptedBytes).byteLength;
  const sha256 = await sha256Hex(encryptedBytes);
  const staged = await initiateMultipartBlobStage(blobAttachmentTestRuntime, {
    byteLength,
    sha256,
    userId: owner.userId,
  });
  const part = await uploadMultipartBlobPartBytes(blobAttachmentTestRuntime, {
    byteLength,
    bytes: blobObjectBytes(encryptedBytes),
    partNumber: 1,
    sha256,
    stageId: staged.stageId,
    uploadId: staged.uploadId,
    userId: owner.userId,
  });
  await completeMultipartBlobStage(blobAttachmentTestRuntime, {
    parts: [{ etag: part.part.etag, partNumber: 1 }],
    stageId: staged.stageId,
    uploadId: staged.uploadId,
    userId: owner.userId,
  });
  return { sha256, stageId: staged.stageId };
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
  readonly contentKeyEpoch: number;
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
      contentKeyEpoch: input.contentKeyEpoch,
      targetHash: input.targets.blobKeyTargetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId: input.blobId,
      nonceDomainHash: await computeContentRecordNonceDomainHash({
        version: 1,
        organizationId: input.targets.organizationId,
        objectKind: "blob",
        objectId: input.blobId,
        contentKeyEpoch: input.contentKeyEpoch,
        encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
        contentRecordId: input.blobId,
      }),
      metadataHash: await computeKeyingDomainHash(
        "tearleads.keying.access-event-body",
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

export async function buildBind(input: {
  readonly activeBindings?: readonly VerifiedAttachmentBinding[];
  readonly blobId: string;
  readonly contentKeyEpoch?: number;
  readonly document: DocumentCreateResponse;
  readonly documents?: readonly DocumentCreateResponse[];
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
  readonly slotId?: string;
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
    slotId: input.slotId ?? "ownership-regression",
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
    activeBindings: [...(input.activeBindings ?? []), bindingResult.value],
    blobId: input.blobId,
    containerKekStates: [input.root.kekState],
    documentManifests: (input.documents ?? [input.document]).map(
      documentManifest,
    ),
    linkedContainerManifests: [containerManifest],
  });
  expect(targetsResult.ok).toBe(true);
  if (!targetsResult.ok) {
    throw targetsResult.error;
  }

  const contentKeyEpoch = input.contentKeyEpoch ?? 1;
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
      contentKeyEpoch,
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
        contentKeyEpoch,
        owner: input.owner,
        sha256: input.stagedBlob.sha256,
        targets: targetsResult.value,
      })) as unknown as Record<string, unknown>,
    };
  }
  return { binding: bindingResult.value, request };
}

export async function buildDetach(input: {
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

export async function bindForTest(input: {
  readonly blobId: string;
  readonly owner: TestUser;
  readonly request: BlobAttachmentBindRequest;
}): Promise<void> {
  await bindBlobAttachment(blobAttachmentTestRuntime, {
    blobId: input.blobId,
    fingerprint: input.owner.fingerprint,
    request: input.request,
    sessionId: "blob-attachment-test-session",
    userId: input.owner.userId,
  });
}

export async function detachForTest(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly blobId: string;
  readonly owner: TestUser;
  readonly request: BlobAttachmentDetachRequest;
}): Promise<void> {
  await detachBlobAttachment(blobAttachmentTestRuntime, {
    bindingId: input.binding.bindingId,
    blobId: input.blobId,
    fingerprint: input.owner.fingerprint,
    request: input.request,
    sessionId: "blob-attachment-test-session",
    userId: input.owner.userId,
  });
}
