import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documents } from "@tearleads/api-shared/schema";
import type {
  AttachmentBindAccessEventBody,
  KeyingCanonicalJson,
  VerifiedAttachmentBinding,
  VerifiedBlobKekTargets,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeAccessManifestHash,
  computeContentRecordNonceDomainHash,
  deriveBlobKekTargets,
  deriveDocumentLinkSetManifest,
  signWriteHeader,
  verifyAttachmentBindingEvent,
  verifyDocumentLinkSetManifest,
} from "@tearleads/crypto";
import type { TestUser } from "@tearleads/test-utils";
import type { BlobAttachmentBindRequest } from "@tearleads/validators/request";
import { storeVerifiedAccessManifest } from "../../src/access/write/accessManifestStore";
import { fixtureBlobMetadataHash } from "./blobEnvelope";
import { contentKeyEnvelopeFixture } from "./contentKeyEnvelope";
import {
  asVerifiedContainerManifest,
  bootstrapRoot as bootstrapStoredRoot,
  createSignedAccessEvent,
} from "./keyingWriterProjectionKit";
import { registerUser } from "./registerUser";
import { createServiceTestRuntime } from "./serviceRuntime";
import { stageBlobEnvelopeFixture } from "./stagedBlobEnvelope";

export interface StoredContainerFixture {
  readonly bundle: VerifiedContainerAccessManifest;
  readonly kekState: VerifiedContainerKekState;
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
}

export interface StoredDocumentFixture {
  readonly bundle: VerifiedDocumentLinkSetManifest;
}

interface BuiltBindRequest {
  readonly request: BlobAttachmentBindRequest;
  readonly verifiedBinding: VerifiedAttachmentBinding;
  readonly blobKekTargets: VerifiedBlobKekTargets;
}

export const runtime = createServiceTestRuntime();

export async function registerOnly(user: TestUser): Promise<void> {
  await registerUser(user);
}

/**
 * The registered root as this file's verified fixture shape; the shared kit
 * reads it back from the store and verifies its KEK state.
 */
export async function bootstrapRoot(
  owner: TestUser,
): Promise<StoredContainerFixture> {
  const root = await bootstrapStoredRoot(owner);

  return { ...root, bundle: asVerifiedContainerManifest(root.bundle) };
}

export async function createDocumentFixture(input: {
  readonly container: StoredContainerFixture;
  readonly documentId?: string;
  readonly owner: TestUser;
}): Promise<StoredDocumentFixture> {
  const documentId = input.documentId ?? crypto.randomUUID();
  const body = {
    blobRewraps: [],
    eventType: "document.link" as const,
    containerId: input.container.bundle.state.containerId,
    containerManifestHash: input.container.bundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [input.container.bundle.manifestHash],
    objectId: documentId,
    objectKind: "document",
    organizationId: input.container.bundle.state.organizationId,
    previousManifestHash: null,
    signer: input.owner,
  });
  const state = {
    version: 1 as const,
    documentId,
    organizationId: input.container.bundle.state.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
    linkedContainerIds: [input.container.bundle.state.containerId],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const verified = await verifyDocumentLinkSetManifest({
    authorizingContainerPaths: [[input.container.bundle]],
    event,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    manifest,
    principalPolicies: input.container.principalPolicies ?? [],
    targetContainerPath: [input.container.bundle],
  });
  expect(verified.ok).toBe(true);
  if (!verified.ok) {
    throw verified.error;
  }

  await db.insert(documents).values({
    id: documentId,
    createdByFingerprint: input.owner.fingerprint,
  });
  await storeVerifiedAccessManifest({ verifiedManifest: verified.value }, db);

  return { bundle: verified.value };
}

export function stageEncryptedBlob(
  input: Parameters<typeof stageBlobEnvelopeFixture>[1],
  serviceRuntime: typeof runtime = runtime,
) {
  return stageBlobEnvelopeFixture(serviceRuntime, input);
}

function contentKeyTargets(
  targets: VerifiedBlobKekTargets,
): BlobAttachmentBindRequest["contentKeyBundle"]["targets"] {
  return targets.targets.map((target) => ({
    ...target,
    ...contentKeyEnvelopeFixture(
      "Blob",
      `${target.bindingId}:${target.containerId}:${target.bindingId}`,
    ),
  }));
}

async function createBlobWriteHeader(input: {
  readonly blobId: string;
  readonly blobKekTargets: VerifiedBlobKekTargets;
  readonly owner: TestUser;
  readonly sha256: string;
}) {
  return signWriteHeader(
    {
      version: 1,
      dependencyManifestHashes: [
        ...new Set(
          input.blobKekTargets.targets.map(
            (target) => target.containerManifestHash,
          ),
        ),
      ].sort(),
      organizationId: input.blobKekTargets.organizationId,
      objectKind: "blob",
      objectId: input.blobId,
      accessManifestHash: input.blobKekTargets.blobAccessManifestHash,
      contentKeyEpoch: 1,
      targetHash: input.blobKekTargets.blobKeyTargetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId: input.blobId,
      nonceDomainHash: await computeContentRecordNonceDomainHash({
        version: 1,
        organizationId: input.blobKekTargets.organizationId,
        objectKind: "blob",
        objectId: input.blobId,
        contentKeyEpoch: 1,
        encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
        contentRecordId: input.blobId,
      }),
      metadataHash: await fixtureBlobMetadataHash(input.blobId),
      ciphertextHash: input.sha256,
      writerUserId: input.owner.userId,
      writerDeviceId: "test-device",
      writerKeyFingerprint: input.owner.fingerprint,
      signedAt: "2026-04-27T12:00:00.000Z",
    },
    input.owner.signing.signingPrivateKey,
  );
}

async function deriveRequiredBlobTargets(input: {
  readonly activeBindings: readonly VerifiedAttachmentBinding[];
  readonly blobId: string;
  readonly container: StoredContainerFixture;
  readonly documents: readonly StoredDocumentFixture[];
}): Promise<VerifiedBlobKekTargets> {
  const derived = await deriveBlobKekTargets({
    activeBindings: input.activeBindings,
    blobId: input.blobId,
    containerKekStates: [input.container.kekState],
    documentManifests: input.documents.map((document) => document.bundle),
    linkedContainerManifests: [input.container.bundle],
  });
  expect(derived.ok).toBe(true);
  if (!derived.ok) {
    throw derived.error;
  }

  return derived.value;
}

export async function buildBindRequest(input: {
  readonly activeBindings?: readonly VerifiedAttachmentBinding[];
  readonly blobId: string;
  readonly bindingId?: string;
  readonly container: StoredContainerFixture;
  readonly document: StoredDocumentFixture;
  readonly documents?: readonly StoredDocumentFixture[];
  readonly expectedBindingId: string | null;
  readonly owner: TestUser;
  readonly slotId: string;
  readonly stagedBlob?: Awaited<ReturnType<typeof stageEncryptedBlob>>;
}): Promise<BuiltBindRequest> {
  const bindingId = input.bindingId ?? crypto.randomUUID();
  const body: AttachmentBindAccessEventBody = {
    eventType: "attachment.bind",
    bindingId,
    blobId: input.blobId,
    documentId: input.document.bundle.state.documentId,
    slotId: input.slotId,
    expectedBindingId: input.expectedBindingId,
    documentManifestHash: input.document.bundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      input.document.bundle.manifestHash,
      input.container.bundle.manifestHash,
    ],
    objectId: input.blobId,
    objectKind: "blob",
    organizationId: input.document.bundle.state.organizationId,
    previousManifestHash: null,
    signer: input.owner,
  });
  const verifiedBinding = await verifyAttachmentBindingEvent({
    authorizingContainerPaths: [[input.container.bundle]],
    body: body as unknown as KeyingCanonicalJson,
    documentManifest: input.document.bundle,
    event: event.event,
    expectedPreviousBindingId: input.expectedBindingId,
    principalPolicies: input.container.principalPolicies ?? [],
    signerPublicKey: input.owner.signing.signingPublicKey,
  });
  expect(verifiedBinding.ok).toBe(true);
  if (!verifiedBinding.ok) {
    throw verifiedBinding.error;
  }

  const activeBindings = [
    ...(input.activeBindings ?? []),
    verifiedBinding.value,
  ];
  const blobKekTargets = await deriveRequiredBlobTargets({
    activeBindings,
    blobId: input.blobId,
    container: input.container,
    documents: input.documents ?? [input.document],
  });
  const allTargets = contentKeyTargets(blobKekTargets);
  const request: BlobAttachmentBindRequest = {
    event: event.event as unknown as Record<string, unknown>,
    body,
    authorizingContainerPathRefs: [
      [
        {
          containerId: input.container.bundle.state.containerId,
          manifestHash: input.container.bundle.manifestHash,
        },
      ],
    ],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      targetHash: blobKekTargets.blobKeyTargetHash,
      targets: allTargets,
    },
  };

  if (input.stagedBlob) {
    request.stagedBlob = {
      stageId: input.stagedBlob.stageId,
      writeHeader: (await createBlobWriteHeader({
        blobId: input.blobId,
        blobKekTargets,
        owner: input.owner,
        sha256: input.stagedBlob.sha256,
      })) as unknown as Record<string, unknown>,
    };
  }

  return { request, verifiedBinding: verifiedBinding.value, blobKekTargets };
}
