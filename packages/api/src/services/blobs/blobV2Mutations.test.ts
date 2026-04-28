import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type {
  AttachmentBindAccessEventBodyV2,
  AttachmentDetachAccessEventBodyV2,
  ContainerAccessEventBodyV2,
  ContainerKeyEpochV2,
  ContainerKeyWrapV2,
  ContainerUserRecipientKeyV2,
  KeyingV2CanonicalJson,
  VerifiedAccessEvent,
  VerifiedAttachmentBinding,
  VerifiedBlobKekTargets,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedDocumentLinkSetManifest,
} from "@tearleads/crypto";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE_V2,
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeContentRecordNonceDomainHash,
  computeKeyingV2DomainHash,
  deriveBlobKekTargets,
  deriveDocumentLinkSetManifest,
  signAccessEvent,
  signWriteHeader,
  verifyAttachmentBindingEvent,
  verifyAttachmentDetachEvent,
  verifyContainerKekState,
  verifyDocumentLinkSetManifest,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type { BlobV2AttachmentBindRequest } from "@tearleads/validators/request";
import { and, eq, isNull } from "drizzle-orm";
import { registerUser } from "../../../test/helpers/registerUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import {
  getAccessManifestBundle,
  storeVerifiedAccessManifest,
} from "../../access/accessManifestStore";
import {
  getCurrentContainerKeyEpoch,
  listContainerKeyWraps,
} from "../../access/containerKekStore";
import { db } from "../../adapters/postgres";
import {
  attachmentBindings,
  containers,
  documentContainerLinks,
  documents,
  users,
} from "../../schema";
import {
  BlobV2MutationError,
  bindBlobAttachmentV2,
  detachBlobAttachmentV2,
} from "./blobV2Mutations";
import { stageBlob } from "./stageBlob";

interface RootContainerFixture {
  readonly id: string;
  readonly organizationId: string;
}

interface StoredV2ContainerFixture {
  readonly bundle: VerifiedContainerAccessManifest;
  readonly kekState: VerifiedContainerKekState;
}

interface StoredV2DocumentFixture {
  readonly bundle: VerifiedDocumentLinkSetManifest;
}

interface BuiltBindRequest {
  readonly request: BlobV2AttachmentBindRequest;
  readonly verifiedBinding: VerifiedAttachmentBinding;
  readonly blobKekTargets: VerifiedBlobKekTargets;
}

const runtime = createServiceTestRuntime();

async function hashOf(label: string): Promise<string> {
  return computeKeyingV2DomainHash("tearleads.keying-v2.access-event-body.v1", {
    label,
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );

  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function registerOnly(user: TestUser): Promise<void> {
  await registerUser(user);
}

async function getRootContainerForUser(
  userId: string,
): Promise<RootContainerFixture> {
  const [user] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    throw new Error("Expected registered user");
  }

  const [rootContainer] = await db
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
    })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, user.defaultOrganizationId),
        isNull(containers.parentId),
      ),
    )
    .limit(1);
  if (!rootContainer) {
    throw new Error("Expected root container");
  }

  return rootContainer;
}

async function verifyAccessEvent(input: {
  readonly body:
    | AttachmentBindAccessEventBodyV2
    | AttachmentDetachAccessEventBodyV2
    | ContainerAccessEventBodyV2
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
      version: 2,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: input.objectKind,
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: input.previousManifestHash,
      dependencyManifestHashes: [...(input.dependencyManifestHashes ?? [])],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingV2CanonicalJson,
      ),
      signerUserId: input.signer.userId,
      signerDeviceId: "test-device",
      signerKeyFingerprint: input.signer.fingerprint,
      signedAt: "2026-04-27T12:00:00.000Z",
    },
    input.signer.signing.signingPrivateKey,
  );
  const verified = await verifySignedAccessEvent({
    body: input.body as unknown as KeyingV2CanonicalJson,
    event,
    signerPublicKey: input.signer.signing.signingPublicKey,
  });

  expect(verified.ok).toBe(true);
  if (!verified.ok) {
    throw verified.error;
  }

  return verified.value;
}

function toContainerKeyEpochV2(
  keyEpoch: Awaited<ReturnType<typeof getCurrentContainerKeyEpoch>>,
): ContainerKeyEpochV2 {
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

function toContainerKeyWrapV2(
  wrap: Awaited<ReturnType<typeof listContainerKeyWraps>>[number],
): ContainerKeyWrapV2 {
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

async function bootstrapRootV2(
  owner: TestUser,
): Promise<StoredV2ContainerFixture> {
  const rootContainer = await getRootContainerForUser(owner.userId);
  const keyEpoch = toContainerKeyEpochV2(
    await getCurrentContainerKeyEpoch(rootContainer.id),
  );
  const bundle = await getAccessManifestBundle(keyEpoch.accessManifestHash);
  if (!bundle) {
    throw new Error("Expected registered root container V2 manifest");
  }
  const wraps = (await listContainerKeyWraps(keyEpoch.id)).map(
    toContainerKeyWrapV2,
  );
  const ownerWrap = wraps.find(
    (wrap) =>
      wrap.recipientKind === "user" && wrap.recipientId === owner.userId,
  );
  if (!ownerWrap) {
    throw new Error("Expected registered root user KEK wrap");
  }
  const ownerKey: ContainerUserRecipientKeyV2 = {
    userId: owner.userId,
    recipientKeyEpochId: ownerWrap.recipientKeyEpochId,
    recipientKeyFingerprint: ownerWrap.recipientKeyFingerprint,
  };
  const kekState = await verifyContainerKekState({
    containerManifest: bundle as unknown as VerifiedContainerAccessManifest,
    keyEpoch,
    userRecipientKeys: [ownerKey],
    wraps,
  });
  expect(kekState.ok).toBe(true);
  if (!kekState.ok) {
    throw kekState.error;
  }

  return {
    bundle: bundle as unknown as VerifiedContainerAccessManifest,
    kekState: kekState.value,
  };
}

async function createDocumentFixture(input: {
  readonly container: StoredV2ContainerFixture;
  readonly documentId?: string;
  readonly owner: TestUser;
}): Promise<StoredV2DocumentFixture> {
  const documentId = input.documentId ?? crypto.randomUUID();
  const body = {
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
    version: 2 as const,
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
  await db.insert(documentContainerLinks).values({
    documentId,
    containerId: input.container.bundle.state.containerId,
  });
  await storeVerifiedAccessManifest({ verifiedManifest: verified.value });

  return { bundle: verified.value };
}

async function stageEncryptedBlob(input: {
  readonly encryptedBytes: string;
  readonly owner: TestUser;
}) {
  const byteLength = new TextEncoder().encode(input.encryptedBytes).byteLength;
  const sha256 = await sha256Hex(input.encryptedBytes);
  const staged = await stageBlob(runtime, {
    encryptedBytes: input.encryptedBytes,
    byteLength,
    sha256,
    userId: input.owner.userId,
  });

  return { ...staged, sha256 };
}

function manifestRequest(
  manifest: VerifiedDocumentLinkSetManifest,
): BlobV2AttachmentBindRequest["documentManifest"] {
  return {
    event: manifest.event.event as unknown as Record<string, unknown>,
    manifest: manifest.manifest as unknown as Record<string, unknown>,
    manifestHash: manifest.manifestHash,
    state: manifest.state as unknown as Record<string, unknown>,
  };
}

function contentKeyTargets(
  targets: VerifiedBlobKekTargets,
): BlobV2AttachmentBindRequest["contentKeyBundle"]["targets"] {
  return targets.targets.map((target) => ({
    ...target,
    wrappedKey: `${target.bindingId}:${target.containerId}:${target.bindingId}`,
    wrappingMetadata: { suite: "test-wrap" },
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
      version: 2,
      organizationId: input.blobKekTargets.organizationId,
      objectKind: "blob",
      objectId: input.blobId,
      accessManifestHash: input.blobKekTargets.blobAccessManifestHash,
      contentKeyEpoch: 1,
      targetHash: input.blobKekTargets.blobKeyTargetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
      contentRecordId: input.blobId,
      nonceDomainHash: await computeContentRecordNonceDomainHash({
        version: 2,
        organizationId: input.blobKekTargets.organizationId,
        objectKind: "blob",
        objectId: input.blobId,
        contentKeyEpoch: 1,
        encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE_V2,
        contentRecordId: input.blobId,
      }),
      metadataHash: await hashOf(`${input.blobId}:metadata`),
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
  readonly container: StoredV2ContainerFixture;
  readonly documents: readonly StoredV2DocumentFixture[];
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

async function buildBindRequest(input: {
  readonly activeBindings?: readonly VerifiedAttachmentBinding[];
  readonly blobId: string;
  readonly bindingId?: string;
  readonly container: StoredV2ContainerFixture;
  readonly document: StoredV2DocumentFixture;
  readonly documents?: readonly StoredV2DocumentFixture[];
  readonly expectedBindingId: string | null;
  readonly owner: TestUser;
  readonly omitExistingTargets?: boolean;
  readonly slotId: string;
  readonly stagedBlob?: Awaited<ReturnType<typeof stageEncryptedBlob>>;
}): Promise<BuiltBindRequest> {
  const bindingId = input.bindingId ?? crypto.randomUUID();
  const body: AttachmentBindAccessEventBodyV2 = {
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
    body: body as unknown as KeyingV2CanonicalJson,
    documentManifest: input.document.bundle,
    event: event.event,
    expectedPreviousBindingId: input.expectedBindingId,
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
  const request: BlobV2AttachmentBindRequest = {
    event: event.event as unknown as Record<string, unknown>,
    body,
    documentManifest: manifestRequest(input.document.bundle),
    authorizingContainerPaths: [
      [input.container.bundle as unknown as Record<string, unknown>],
    ],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      targetHash: blobKekTargets.blobKeyTargetHash,
      targets: input.omitExistingTargets ? allTargets.slice(-1) : allTargets,
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

async function buildDetachRequest(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly container: StoredV2ContainerFixture;
  readonly document: StoredV2DocumentFixture;
  readonly owner: TestUser;
}) {
  const body: AttachmentDetachAccessEventBodyV2 = {
    eventType: "attachment.detach",
    bindingId: input.binding.bindingId,
    blobId: input.binding.blobId,
    documentId: input.binding.documentId,
    slotId: input.binding.slotId,
    documentManifestHash: input.document.bundle.manifestHash,
  };
  const event = await verifyAccessEvent({
    body,
    dependencyManifestHashes: [
      input.document.bundle.manifestHash,
      input.container.bundle.manifestHash,
    ],
    objectId: input.binding.blobId,
    objectKind: "blob",
    organizationId: input.document.bundle.state.organizationId,
    previousManifestHash: null,
    signer: input.owner,
  });
  const verifiedDetach = await verifyAttachmentDetachEvent({
    authorizingContainerPaths: [[input.container.bundle]],
    body: body as unknown as KeyingV2CanonicalJson,
    documentManifest: input.document.bundle,
    event: event.event,
    expectedBindingId: input.binding.bindingId,
    signerPublicKey: input.owner.signing.signingPublicKey,
  });
  expect(verifiedDetach.ok).toBe(true);

  return {
    event: event.event as unknown as Record<string, unknown>,
    body,
    documentManifest: manifestRequest(input.document.bundle),
    authorizingContainerPaths: [
      [input.container.bundle as unknown as Record<string, unknown>],
    ],
  };
}

async function loadAttachmentBinding(bindingId: string) {
  const [row] = await db
    .select()
    .from(attachmentBindings)
    .where(eq(attachmentBindings.id, bindingId))
    .limit(1);

  return row ?? null;
}

test("bindBlobAttachmentV2 attaches, replaces, and detaches signed bindings", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRootV2(owner);
  const document = await createDocumentFixture({ container, owner });

  const firstBlobId = crypto.randomUUID();
  const firstStage = await stageEncryptedBlob({
    encryptedBytes: "first-encrypted-bytes",
    owner,
  });
  const firstBind = await buildBindRequest({
    blobId: firstBlobId,
    container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "slot-a",
    stagedBlob: firstStage,
  });
  const firstResponse = await bindBlobAttachmentV2(runtime, {
    blobId: firstBlobId,
    fingerprint: owner.fingerprint,
    request: firstBind.request,
    userId: owner.userId,
  });
  expect(firstResponse.bindingId).toBe(firstBind.verifiedBinding.bindingId);
  expect(firstResponse.writeHeaderHash).toMatch(/^[0-9a-f]{64}$/);
  expect(firstResponse.blobKekTargets.activeBindingIds).toEqual([
    firstBind.verifiedBinding.bindingId,
  ]);

  const replacementBlobId = crypto.randomUUID();
  const replacementStage = await stageEncryptedBlob({
    encryptedBytes: "replacement-encrypted-bytes",
    owner,
  });
  const replacementBind = await buildBindRequest({
    blobId: replacementBlobId,
    container,
    document,
    expectedBindingId: firstBind.verifiedBinding.bindingId,
    owner,
    slotId: "slot-a",
    stagedBlob: replacementStage,
  });
  const replacementResponse = await bindBlobAttachmentV2(runtime, {
    blobId: replacementBlobId,
    fingerprint: owner.fingerprint,
    request: replacementBind.request,
    userId: owner.userId,
  });
  expect(replacementResponse.bindingId).toBe(
    replacementBind.verifiedBinding.bindingId,
  );
  expect(
    (await loadAttachmentBinding(firstBind.verifiedBinding.bindingId))
      ?.detachedAt,
  ).toBeInstanceOf(Date);
  expect(
    (await loadAttachmentBinding(replacementBind.verifiedBinding.bindingId))
      ?.detachedAt,
  ).toBeNull();

  const detachRequest = await buildDetachRequest({
    binding: replacementBind.verifiedBinding,
    container,
    document,
    owner,
  });
  const detachResponse = await detachBlobAttachmentV2(runtime, {
    bindingId: replacementBind.verifiedBinding.bindingId,
    blobId: replacementBlobId,
    fingerprint: owner.fingerprint,
    request: detachRequest,
    userId: owner.userId,
  });
  expect(detachResponse.bindingId).toBe(
    replacementBind.verifiedBinding.bindingId,
  );
  expect(
    (await loadAttachmentBinding(replacementBind.verifiedBinding.bindingId))
      ?.detachedAt,
  ).toBeInstanceOf(Date);
});

test("bindBlobAttachmentV2 rejects stale slot bindings and omitted shared blob targets", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRootV2(owner);
  const firstDocument = await createDocumentFixture({ container, owner });
  const secondDocument = await createDocumentFixture({ container, owner });
  const blobId = crypto.randomUUID();
  const firstStage = await stageEncryptedBlob({
    encryptedBytes: "shared-encrypted-bytes",
    owner,
  });
  const firstBind = await buildBindRequest({
    blobId,
    container,
    document: firstDocument,
    expectedBindingId: null,
    owner,
    slotId: "slot-a",
    stagedBlob: firstStage,
  });
  await bindBlobAttachmentV2(runtime, {
    blobId,
    fingerprint: owner.fingerprint,
    request: firstBind.request,
    userId: owner.userId,
  });

  const staleReplacement = await buildBindRequest({
    blobId: crypto.randomUUID(),
    container,
    document: firstDocument,
    expectedBindingId: null,
    owner,
    slotId: "slot-a",
    stagedBlob: await stageEncryptedBlob({
      encryptedBytes: "stale-replacement-bytes",
      owner,
    }),
  });
  await expect(
    bindBlobAttachmentV2(runtime, {
      blobId: staleReplacement.verifiedBinding.blobId,
      fingerprint: owner.fingerprint,
      request: staleReplacement.request,
      userId: owner.userId,
    }),
  ).rejects.toMatchObject(
    new BlobV2MutationError(
      "attachment binding previous binding id does not match expected binding id",
      409,
    ),
  );

  const omittedTargetsBind = await buildBindRequest({
    activeBindings: [firstBind.verifiedBinding],
    blobId,
    container,
    document: secondDocument,
    documents: [firstDocument, secondDocument],
    expectedBindingId: null,
    omitExistingTargets: true,
    owner,
    slotId: "slot-b",
  });
  await expect(
    bindBlobAttachmentV2(runtime, {
      blobId,
      fingerprint: owner.fingerprint,
      request: omittedTargetsBind.request,
      userId: owner.userId,
    }),
  ).rejects.toMatchObject(
    new BlobV2MutationError(
      "Blob content-key targets do not match current KEK targets",
      409,
    ),
  );

  const sharedBind = await buildBindRequest({
    activeBindings: [firstBind.verifiedBinding],
    blobId,
    container,
    document: secondDocument,
    documents: [firstDocument, secondDocument],
    expectedBindingId: null,
    owner,
    slotId: "slot-b",
  });
  const sharedResponse = await bindBlobAttachmentV2(runtime, {
    blobId,
    fingerprint: owner.fingerprint,
    request: sharedBind.request,
    userId: owner.userId,
  });
  expect(sharedResponse.blobKekTargets.activeBindingIds.sort()).toEqual(
    [
      firstBind.verifiedBinding.bindingId,
      sharedBind.verifiedBinding.bindingId,
    ].sort(),
  );
  expect(sharedResponse.contentKeyBundle.targets).toHaveLength(2);
});
