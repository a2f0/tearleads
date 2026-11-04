import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documents } from "@tearleads/api-shared/schema";
import type {
  AttachmentBindAccessEventBody,
  AttachmentDetachAccessEventBody,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  KeyingCanonicalJson,
  VerifiedAccessEvent,
  VerifiedAttachmentBinding,
  VerifiedBlobKekTargets,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeContentRecordNonceDomainHash,
  deriveBlobKekTargets,
  deriveDocumentLinkSetManifest,
  signAccessEvent,
  signWriteHeader,
  verifyAttachmentBindingEvent,
  verifyContainerKekState,
  verifyDocumentLinkSetManifest,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type { TestUser } from "@tearleads/test-utils";
import type { BlobAttachmentBindRequest } from "@tearleads/validators/request";
import { getAccessManifestBundle } from "../../src/access/read/accessManifestStore";
import {
  getCurrentContainerKeyEpoch,
  listContainerKeyWraps,
} from "../../src/access/read/containerKekStore";
import { storeVerifiedAccessManifest } from "../../src/access/write/accessManifestStore";
import { fixtureBlobMetadataHash } from "./blobEnvelope";
import { contentKeyEnvelopeFixture } from "./contentKeyEnvelope";
import { getRootContainerForUser } from "./personalRootContainer";
import { loadVerifiedPrincipalPolicy } from "./principalPolicy";
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

export async function verifyAccessEvent(input: {
  readonly body:
    | AttachmentBindAccessEventBody
    | AttachmentDetachAccessEventBody
    | {
        readonly eventType: "document.link";
        readonly containerId: string;
        readonly containerManifestHash: string;
      };
  readonly dependencyManifestHashes?: readonly string[];
  readonly objectId: string;
  readonly objectKind: "blob" | "container" | "document";
  readonly organizationId: string;
  readonly previousManifestHash: string | null;
  readonly signer: TestUser;
}): Promise<VerifiedAccessEvent> {
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: input.objectKind,
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: input.previousManifestHash,
      dependencyManifestHashes: [...(input.dependencyManifestHashes ?? [])],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: input.signer.userId,
      signerDeviceId: "test-device",
      signerKeyFingerprint: input.signer.fingerprint,
      signedAt: "2026-04-27T12:00:00.000Z",
    },
    input.signer.signing.signingPrivateKey,
  );
  const verified = await verifySignedAccessEvent({
    body: input.body as unknown as KeyingCanonicalJson,
    event,
    signerPublicKey: input.signer.signing.signingPublicKey,
  });

  expect(verified.ok).toBe(true);
  if (!verified.ok) {
    throw verified.error;
  }

  return verified.value;
}

function toContainerKeyEpoch(
  keyEpoch: Awaited<ReturnType<typeof getCurrentContainerKeyEpoch>>,
): ContainerKeyEpoch {
  if (!keyEpoch) {
    throw new Error("Expected container key epoch");
  }

  return {
    id: keyEpoch.id,
    containerId: keyEpoch.containerId,
    keyEpoch: keyEpoch.keyEpoch,
    accessManifestHash: keyEpoch.accessManifestHash,
    parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
    createdByEventHash: keyEpoch.createdByEventHash,
    createdByManifestHash: keyEpoch.createdByManifestHash,
  };
}

function toContainerKeyWrap(
  wrap: Awaited<ReturnType<typeof listContainerKeyWraps>>[number],
): ContainerKeyWrap {
  return {
    containerKeyEpochId: wrap.containerKeyEpochId,
    recipientKind: wrap.recipientKind,
    recipientId: wrap.recipientId,
    recipientKeyEpochId: wrap.recipientKeyEpochId,
    recipientKeyFingerprint: wrap.recipientKeyFingerprint,
    kemCipherText: wrap.kemCipherText,
    wrappedKey: wrap.wrappedKey,
    wrapManifestHash: wrap.wrapManifestHash,
  };
}

export async function bootstrapRoot(
  owner: TestUser,
): Promise<StoredContainerFixture> {
  const rootContainer = await getRootContainerForUser(owner.userId);
  const keyEpoch = toContainerKeyEpoch(
    await getCurrentContainerKeyEpoch(rootContainer.id, db),
  );
  const bundle = await getAccessManifestBundle(keyEpoch.accessManifestHash, db);
  if (!bundle) {
    throw new Error("Expected registered root container manifest");
  }
  const wraps = (await listContainerKeyWraps(keyEpoch.id, db)).map(
    toContainerKeyWrap,
  );
  const adminPolicy = await loadVerifiedPrincipalPolicy(
    db,
    "group",
    rootContainer.adminGroupId,
  );
  const kekState = await verifyContainerKekState({
    containerManifest: bundle as unknown as VerifiedContainerAccessManifest,
    keyEpoch,
    principalPolicies: [adminPolicy],
    wraps,
  });
  expect(kekState.ok).toBe(true);
  if (!kekState.ok) {
    throw kekState.error;
  }

  return {
    bundle: bundle as unknown as VerifiedContainerAccessManifest,
    kekState: kekState.value,
    principalPolicies: [adminPolicy],
  };
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
  const event = await verifyAccessEvent({
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
  const event = await verifyAccessEvent({
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
