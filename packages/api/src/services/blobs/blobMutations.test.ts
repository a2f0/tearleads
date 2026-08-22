import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  attachmentBindings,
  blobAuditObjects,
  blobs,
  containers,
  documentAttachmentAuditEvents,
  documentAuditEntries,
  documentContainerLinks,
  documents,
  organizations,
  users,
} from "@symcrypt/api-shared/schema";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
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
} from "@symcrypt/crypto";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeContentRecordNonceDomainHash,
  computeKeyingDomainHash,
  deriveBlobKekTargets,
  deriveDocumentLinkSetManifest,
  signAccessEvent,
  signWriteHeader,
  verifyAttachmentBindingEvent,
  verifyAttachmentDetachEvent,
  verifyContainerKekState,
  verifyDocumentLinkSetManifest,
  verifySignedAccessEvent,
} from "@symcrypt/crypto";
import type { BlobAttachmentBindRequest } from "@symcrypt/validators/request";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { blobObjectBytes } from "../../../test/helpers/blobObjectStore";
import {
  appendUnexpectedUserWrapToRekey,
  buildRootContainerRekeyMutation,
} from "../../../test/helpers/containerRekey";
import { loadVerifiedPrincipalPolicy } from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  createFailingRuntime,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { getAccessManifestBundle } from "../../access/read/accessManifestStore";
import {
  getCurrentContainerKeyEpoch,
  listContainerKeyWraps,
} from "../../access/read/containerKekStore";
import { storeVerifiedAccessManifest } from "../../access/write/accessManifestStore";
import { verifyDocumentAuditHistory } from "../../documents/verifyDocumentAuditHistory";
import {
  BlobMutationError,
  bindBlobAttachment,
  detachBlobAttachment,
} from "./blobMutations";
import { getBlobBytes } from "./getBlob";
import {
  completeMultipartBlobStage,
  initiateMultipartBlobStage,
  uploadMultipartBlobPartBytes,
} from "./multipartStage";

interface RootContainerFixture {
  readonly adminGroupId: string;
  readonly id: string;
  readonly organizationId: string;
}

interface StoredContainerFixture {
  readonly bundle: VerifiedContainerAccessManifest;
  readonly kekState: VerifiedContainerKekState;
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
}

interface StoredDocumentFixture {
  readonly bundle: VerifiedDocumentLinkSetManifest;
}

interface BuiltBindRequest {
  readonly request: BlobAttachmentBindRequest;
  readonly verifiedBinding: VerifiedAttachmentBinding;
  readonly blobKekTargets: VerifiedBlobKekTargets;
}

const runtime = createServiceTestRuntime();

async function hashOf(label: string): Promise<string> {
  return computeKeyingDomainHash("symcrypt.keying.access-event-body", {
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

  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, rootContainer.organizationId))
    .limit(1);
  if (!organization) {
    throw new Error("Expected registered organization");
  }

  return { ...rootContainer, adminGroupId: organization.adminGroupId };
}

async function verifyAccessEvent(input: {
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

async function bootstrapRoot(owner: TestUser): Promise<StoredContainerFixture> {
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

async function createDocumentFixture(input: {
  readonly container: StoredContainerFixture;
  readonly documentId?: string;
  readonly owner: TestUser;
}): Promise<StoredDocumentFixture> {
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
  await db.insert(documentContainerLinks).values({
    documentId,
    containerId: input.container.bundle.state.containerId,
  });
  await storeVerifiedAccessManifest({ verifiedManifest: verified.value }, db);

  return { bundle: verified.value };
}

async function stageEncryptedBlob(
  input: {
    readonly encryptedBytes: string;
    readonly owner: TestUser;
  },
  serviceRuntime: typeof runtime = runtime,
) {
  const byteLength = new TextEncoder().encode(input.encryptedBytes).byteLength;
  const sha256 = await sha256Hex(input.encryptedBytes);
  const staged = await initiateMultipartBlobStage(serviceRuntime, {
    byteLength,
    sha256,
    userId: input.owner.userId,
  });
  const part = await uploadMultipartBlobPartBytes(serviceRuntime, {
    byteLength,
    bytes: blobObjectBytes(input.encryptedBytes),
    partNumber: 1,
    sha256,
    stageId: staged.stageId,
    uploadId: staged.uploadId,
    userId: input.owner.userId,
  });
  await completeMultipartBlobStage(serviceRuntime, {
    parts: [{ etag: part.part.etag, partNumber: 1 }],
    stageId: staged.stageId,
    uploadId: staged.uploadId,
    userId: input.owner.userId,
  });

  return { ...staged, sha256 };
}

function contentKeyTargets(
  targets: VerifiedBlobKekTargets,
): BlobAttachmentBindRequest["contentKeyBundle"]["targets"] {
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
      version: 1,
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

async function buildBindRequest(input: {
  readonly activeBindings?: readonly VerifiedAttachmentBinding[];
  readonly blobId: string;
  readonly bindingId?: string;
  readonly container: StoredContainerFixture;
  readonly document: StoredDocumentFixture;
  readonly documents?: readonly StoredDocumentFixture[];
  readonly expectedBindingId: string | null;
  readonly owner: TestUser;
  readonly omitExistingTargets?: boolean;
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
  readonly container: StoredContainerFixture;
  readonly document: StoredDocumentFixture;
  readonly owner: TestUser;
}) {
  const body: AttachmentDetachAccessEventBody = {
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
    body: body as unknown as KeyingCanonicalJson,
    documentManifest: input.document.bundle,
    event: event.event,
    expectedBindingId: input.binding.bindingId,
    principalPolicies: input.container.principalPolicies ?? [],
    signerPublicKey: input.owner.signing.signingPublicKey,
  });
  expect(verifiedDetach.ok).toBe(true);

  return {
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

async function loadBlobReviveState(blobId: string) {
  const [blobRows, bindingRows, auditRows] = await Promise.all([
    db
      .select({ dereferencedAt: blobs.dereferencedAt, id: blobs.id })
      .from(blobs)
      .where(eq(blobs.id, blobId)),
    db
      .select({
        detachedAt: attachmentBindings.detachedAt,
        documentId: attachmentBindings.documentId,
        id: attachmentBindings.id,
      })
      .from(attachmentBindings)
      .where(eq(attachmentBindings.blobId, blobId))
      .orderBy(asc(attachmentBindings.id)),
    db
      .select({
        liveStorageKey: blobAuditObjects.liveStorageKey,
        objectDeletedAt: blobAuditObjects.objectDeletedAt,
        prunedAt: blobAuditObjects.prunedAt,
      })
      .from(blobAuditObjects)
      .where(eq(blobAuditObjects.blobId, blobId)),
  ]);
  return { auditRows, bindingRows, blobRows };
}

async function loadDocumentAndContainerUpdatedAt(input: {
  readonly containerId: string;
  readonly documentId: string;
}): Promise<{
  readonly containerUpdatedAt: Date;
  readonly documentUpdatedAt: Date;
}> {
  const [[documentRow], [containerRow]] = await Promise.all([
    db
      .select({ updatedAt: documents.updatedAt })
      .from(documents)
      .where(eq(documents.id, input.documentId))
      .limit(1),
    db
      .select({ updatedAt: containers.updatedAt })
      .from(containers)
      .where(eq(containers.id, input.containerId))
      .limit(1),
  ]);
  if (!documentRow) {
    throw new Error(`Expected document sync row for ${input.documentId}`);
  }
  if (!containerRow) {
    throw new Error(`Expected container sync row for ${input.containerId}`);
  }

  return {
    containerUpdatedAt: containerRow.updatedAt,
    documentUpdatedAt: documentRow.updatedAt,
  };
}

async function setDocumentAndContainerUpdatedAt(input: {
  readonly containerId: string;
  readonly documentId: string;
  readonly updatedAt: Date;
}): Promise<void> {
  await Promise.all([
    db
      .update(documents)
      .set({ updatedAt: input.updatedAt })
      .where(eq(documents.id, input.documentId)),
    db
      .update(containers)
      .set({ updatedAt: input.updatedAt })
      .where(eq(containers.id, input.containerId)),
  ]);
}

test("attachment writes tolerate publish failures", async () => {
  const owner = createTestUser();
  const publishedEvents: Array<Record<string, unknown>> = [];
  const failureRuntime = createFailingRuntime((event) =>
    publishedEvents.push(event),
  );
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const document = await createDocumentFixture({ container, owner });
  const documentId = document.bundle.state.documentId;
  const containerId = container.bundle.state.containerId;
  const firstBlobId = crypto.randomUUID();
  const firstStage = await stageEncryptedBlob(
    {
      encryptedBytes: "first-encrypted-bytes",
      owner,
    },
    failureRuntime,
  );
  const firstBind = await buildBindRequest({
    blobId: firstBlobId,
    container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "slot-a",
    stagedBlob: firstStage,
  });
  const preBindUpdatedAt = new Date("2026-05-05T00:00:00.000Z");
  await setDocumentAndContainerUpdatedAt({
    containerId,
    documentId,
    updatedAt: preBindUpdatedAt,
  });
  const firstResponse = await bindBlobAttachment(failureRuntime, {
    blobId: firstBlobId,
    fingerprint: owner.fingerprint,
    request: firstBind.request,
    sessionId: "test-session",
    userId: owner.userId,
  });
  expect(firstResponse.bindingId).toBe(firstBind.verifiedBinding.bindingId);
  expect(firstResponse.writeHeaderHash).toMatch(/^[0-9a-f]{64}$/);
  expect(firstResponse.blobKekTargets.activeBindingIds).toEqual([
    firstBind.verifiedBinding.bindingId,
  ]);
  const afterBindTimestamps = await loadDocumentAndContainerUpdatedAt({
    containerId,
    documentId,
  });
  expect(afterBindTimestamps.documentUpdatedAt.toISOString()).not.toBe(
    preBindUpdatedAt.toISOString(),
  );
  expect(afterBindTimestamps.containerUpdatedAt.toISOString()).toBe(
    afterBindTimestamps.documentUpdatedAt.toISOString(),
  );
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
  const replacementResponse = await bindBlobAttachment(runtime, {
    blobId: replacementBlobId,
    fingerprint: owner.fingerprint,
    request: replacementBind.request,
    sessionId: "test-session",
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
  const preDetachUpdatedAt = new Date("2026-05-05T00:05:00.000Z");
  await setDocumentAndContainerUpdatedAt({
    containerId,
    documentId,
    updatedAt: preDetachUpdatedAt,
  });
  const detachRequest = await buildDetachRequest({
    binding: replacementBind.verifiedBinding,
    container,
    document,
    owner,
  });
  Reflect.set(detachRequest, "contentKeyBundle", 0);
  const detachResponse = await detachBlobAttachment(failureRuntime, {
    bindingId: replacementBind.verifiedBinding.bindingId,
    blobId: replacementBlobId,
    fingerprint: owner.fingerprint,
    request: detachRequest,
    sessionId: "test-session",
    userId: owner.userId,
  });
  expect(detachResponse.bindingId).toBe(
    replacementBind.verifiedBinding.bindingId,
  );
  expect(
    (await loadAttachmentBinding(replacementBind.verifiedBinding.bindingId))
      ?.detachedAt,
  ).toBeInstanceOf(Date);
  const afterDetachTimestamps = await loadDocumentAndContainerUpdatedAt({
    containerId,
    documentId,
  });
  expect(afterDetachTimestamps.documentUpdatedAt.toISOString()).not.toBe(
    preDetachUpdatedAt.toISOString(),
  );
  expect(afterDetachTimestamps.containerUpdatedAt.toISOString()).toBe(
    afterDetachTimestamps.documentUpdatedAt.toISOString(),
  );
  expect(publishedEvents).toHaveLength(2);
  const attachmentAuditEvents = await db
    .select({
      action: documentAttachmentAuditEvents.action,
      bindingId: documentAttachmentAuditEvents.bindingId,
      blobId: documentAttachmentAuditEvents.blobId,
      previousBindingId: documentAttachmentAuditEvents.previousBindingId,
      previousBlobId: documentAttachmentAuditEvents.previousBlobId,
      slotId: documentAttachmentAuditEvents.slotId,
    })
    .from(documentAttachmentAuditEvents)
    .innerJoin(
      documentAuditEntries,
      eq(documentAuditEntries.id, documentAttachmentAuditEvents.auditEntryId),
    )
    .where(
      eq(documentAuditEntries.documentId, document.bundle.state.documentId),
    )
    .orderBy(documentAuditEntries.sequence);
  expect(attachmentAuditEvents).toEqual([
    {
      action: "attach",
      bindingId: firstBind.verifiedBinding.bindingId,
      blobId: firstBlobId,
      previousBindingId: null,
      previousBlobId: null,
      slotId: "slot-a",
    },
    {
      action: "replace",
      bindingId: replacementBind.verifiedBinding.bindingId,
      blobId: replacementBlobId,
      previousBindingId: firstBind.verifiedBinding.bindingId,
      previousBlobId: firstBlobId,
      slotId: "slot-a",
    },
    {
      action: "detach",
      bindingId: replacementBind.verifiedBinding.bindingId,
      blobId: replacementBlobId,
      previousBindingId: null,
      previousBlobId: null,
      slotId: "slot-a",
    },
  ]);
  const auditedBlobs = await db
    .select({ blobId: blobAuditObjects.blobId })
    .from(blobAuditObjects)
    .where(inArray(blobAuditObjects.blobId, [firstBlobId, replacementBlobId]));
  expect(new Set(auditedBlobs.map((blob) => blob.blobId))).toEqual(
    new Set([firstBlobId, replacementBlobId]),
  );
  const auditHistory = await verifyDocumentAuditHistory(db, {
    documentId: document.bundle.state.documentId,
  });
  expect(auditHistory).toMatchObject({
    attachmentEventCount: 3,
    auditEntryCount: 3,
    checkpointCount: 0,
    isValid: true,
    updateEventCount: 0,
  });
});

test("a cross-organization bind cannot revive a dereferenced blob", async () => {
  const sourceOwner = createTestUser();
  const targetOwner = createTestUser();
  await registerOnly(sourceOwner);
  await registerOnly(targetOwner);
  const sourceContainer = await bootstrapRoot(sourceOwner);
  const sourceDocument = await createDocumentFixture({
    container: sourceContainer,
    owner: sourceOwner,
  });
  const blobId = crypto.randomUUID();
  const sourceBind = await buildBindRequest({
    blobId,
    container: sourceContainer,
    document: sourceDocument,
    expectedBindingId: null,
    owner: sourceOwner,
    slotId: "source-slot",
    stagedBlob: await stageEncryptedBlob({
      encryptedBytes: "source-organization-bytes",
      owner: sourceOwner,
    }),
  });
  await bindBlobAttachment(runtime, {
    blobId,
    fingerprint: sourceOwner.fingerprint,
    request: sourceBind.request,
    sessionId: "source-session",
    userId: sourceOwner.userId,
  });
  await detachBlobAttachment(runtime, {
    bindingId: sourceBind.verifiedBinding.bindingId,
    blobId,
    fingerprint: sourceOwner.fingerprint,
    request: await buildDetachRequest({
      binding: sourceBind.verifiedBinding,
      container: sourceContainer,
      document: sourceDocument,
      owner: sourceOwner,
    }),
    sessionId: "source-session",
    userId: sourceOwner.userId,
  });
  const before = await loadBlobReviveState(blobId);
  expect(before.blobRows[0]?.dereferencedAt).toBeInstanceOf(Date);

  const targetContainer = await bootstrapRoot(targetOwner);
  const targetDocument = await createDocumentFixture({
    container: targetContainer,
    owner: targetOwner,
  });
  const targetBind = await buildBindRequest({
    blobId,
    container: targetContainer,
    document: targetDocument,
    expectedBindingId: null,
    owner: targetOwner,
    slotId: "target-slot",
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
  expect(await loadBlobReviveState(blobId)).toEqual(before);
});

test("bindBlobAttachment applies optional container rekeys before target validation", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: container,
    signer: owner,
  });
  const document = await createDocumentFixture({
    container: rekey.container,
    owner,
  });
  const blobId = crypto.randomUUID();
  const bind = await buildBindRequest({
    blobId,
    container: rekey.container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "preview",
    stagedBlob: await stageEncryptedBlob({
      encryptedBytes: "opportunistic-rekey-bytes",
      owner,
    }),
  });
  bind.request.containerRekeys = [rekey.request];

  const response = await bindBlobAttachment(runtime, {
    blobId,
    fingerprint: owner.fingerprint,
    request: bind.request,
    sessionId: "test-session",
    userId: owner.userId,
  });

  expect(response.blobKekTargets.linkedContainerKeyEpochIds).toEqual([
    rekey.container.kekState.containerKeyEpochId,
  ]);
  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    container.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(
    rekey.container.kekState.containerKeyEpochId,
  );
});

async function expectStagePromotesToObjectStore(input: {
  readonly encryptedBytes: string;
  readonly owner: TestUser;
  readonly serviceRuntime: typeof runtime;
  readonly sha256: string;
  readonly stagedBlob: Awaited<ReturnType<typeof stageEncryptedBlob>>;
}) {
  const { owner } = input;
  const container = await bootstrapRoot(owner);
  const document = await createDocumentFixture({ container, owner });
  const blobId = crypto.randomUUID();
  const bind = await buildBindRequest({
    blobId,
    container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "preview",
    stagedBlob: input.stagedBlob,
  });

  await bindBlobAttachment(input.serviceRuntime, {
    blobId,
    fingerprint: owner.fingerprint,
    request: bind.request,
    sessionId: "test-session",
    userId: owner.userId,
  });

  const [storedBlob] = await db
    .select({
      storageKey: blobs.storageKey,
    })
    .from(blobs)
    .where(eq(blobs.id, blobId))
    .limit(1);
  expect(storedBlob?.storageKey).toBe(
    `blob-stages/${input.stagedBlob.stageId}`,
  );

  const blob = await getBlobBytes(input.serviceRuntime, {
    blobId,
    userId: owner.userId,
  });
  expect(blob.sha256).toBe(input.sha256);
  const text = await new Response(blob.encryptedBytes).text();
  expect(text).toBe(input.encryptedBytes);
}

test("bind promotes multipart stages without inline bytes", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const encryptedBytes = "multipart-bind-encrypted-bytes";
  const multipartStage = await stageEncryptedBlob({
    encryptedBytes,
    owner,
  });

  await expectStagePromotesToObjectStore({
    encryptedBytes,
    owner,
    serviceRuntime: runtime,
    sha256: multipartStage.sha256,
    stagedBlob: multipartStage,
  });
});

test("bindBlobAttachment prevalidates multipart object bytes before opening the transaction", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const document = await createDocumentFixture({ container, owner });
  const baseRuntime = createServiceTestRuntime();
  let transactionDepth = 0;
  let readObjectOutsideTransaction = false;
  const trackingDb = new Proxy(baseRuntime.db, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "transaction" || typeof value !== "function") {
        return value;
      }

      return async (...args: unknown[]) => {
        transactionDepth += 1;
        try {
          return await Reflect.apply(value, target, args);
        } finally {
          transactionDepth -= 1;
        }
      };
    },
  }) as typeof baseRuntime.db;
  const trackingRuntime: typeof baseRuntime = {
    ...baseRuntime,
    blobObjectStore: {
      ...baseRuntime.blobObjectStore,
      getObjectStream: async (key: string) => {
        expect(transactionDepth).toBe(0);
        readObjectOutsideTransaction = true;

        return baseRuntime.blobObjectStore.getObjectStream(key);
      },
    },
    db: trackingDb,
  };
  const blobId = crypto.randomUUID();
  const multipartStage = await stageEncryptedBlob(
    {
      encryptedBytes: "multipart-prevalidation-bytes",
      owner,
    },
    trackingRuntime,
  );
  const bind = await buildBindRequest({
    blobId,
    container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "preview",
    stagedBlob: multipartStage,
  });

  await bindBlobAttachment(trackingRuntime, {
    blobId,
    fingerprint: owner.fingerprint,
    request: bind.request,
    sessionId: "test-session",
    userId: owner.userId,
  });

  expect(readObjectOutsideTransaction).toBe(true);
});

test("bindBlobAttachment rolls back optional rekeys when blob write validation fails", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: container,
    signer: owner,
  });
  const document = await createDocumentFixture({
    container: rekey.container,
    owner,
  });
  const blobId = crypto.randomUUID();
  const bind = await buildBindRequest({
    blobId,
    container: rekey.container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "preview",
    stagedBlob: await stageEncryptedBlob({
      encryptedBytes: "rollback-rekey-bytes",
      owner,
    }),
  });
  bind.request.containerRekeys = [rekey.request];
  if (!bind.request.stagedBlob) {
    throw new Error("Expected staged blob request");
  }
  bind.request.stagedBlob.writeHeader = {
    ...bind.request.stagedBlob.writeHeader,
    version: 2,
  };

  await expect(
    bindBlobAttachment(runtime, {
      blobId,
      fingerprint: owner.fingerprint,
      request: bind.request,
      sessionId: "test-session",
      userId: owner.userId,
    }),
  ).rejects.toMatchObject({
    status: 400,
  });
  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    container.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(container.kekState.containerKeyEpochId);
});

test("bindBlobAttachment rejects invalid optional container rekeys", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: container,
    signer: owner,
  });
  appendUnexpectedUserWrapToRekey(rekey.request);
  const document = await createDocumentFixture({
    container: rekey.container,
    owner,
  });
  const blobId = crypto.randomUUID();
  const bind = await buildBindRequest({
    blobId,
    container: rekey.container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "preview",
    stagedBlob: await stageEncryptedBlob({
      encryptedBytes: "invalid-rekey-bytes",
      owner,
    }),
  });
  bind.request.containerRekeys = [rekey.request];

  await expect(
    bindBlobAttachment(runtime, {
      blobId,
      fingerprint: owner.fingerprint,
      request: bind.request,
      sessionId: "test-session",
      userId: owner.userId,
    }),
  ).rejects.toMatchObject({
    message: "container key wrap is not justified by its manifest",
    status: 409,
  });
  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    container.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(container.kekState.containerKeyEpochId);
});

test("bindBlobAttachment rejects malformed signed event records", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const document = await createDocumentFixture({ container, owner });

  const malformedBind = await buildBindRequest({
    blobId: crypto.randomUUID(),
    container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "slot-a",
  });
  malformedBind.request.event = {
    ...malformedBind.request.event,
    version: "2",
  };

  await expect(
    bindBlobAttachment(runtime, {
      blobId: malformedBind.verifiedBinding.blobId,
      fingerprint: owner.fingerprint,
      request: malformedBind.request,
      sessionId: "test-session",
      userId: owner.userId,
    }),
  ).rejects.toMatchObject(
    new BlobMutationError("Blob event.version is invalid", 400),
  );
});

test("bindBlobAttachment rejects malformed staged blob write headers", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const document = await createDocumentFixture({ container, owner });

  const malformedBind = await buildBindRequest({
    blobId: crypto.randomUUID(),
    container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "slot-a",
    stagedBlob: await stageEncryptedBlob({
      encryptedBytes: "malformed-write-header-bytes",
      owner,
    }),
  });
  if (!malformedBind.request.stagedBlob) {
    throw new Error("Expected staged blob request");
  }
  malformedBind.request.stagedBlob.writeHeader = {
    ...malformedBind.request.stagedBlob.writeHeader,
    version: "2",
  };

  await expect(
    bindBlobAttachment(runtime, {
      blobId: malformedBind.verifiedBinding.blobId,
      fingerprint: owner.fingerprint,
      request: malformedBind.request,
      sessionId: "test-session",
      userId: owner.userId,
    }),
  ).rejects.toMatchObject(
    new BlobMutationError("Blob write header.version is invalid", 400),
  );
});

test("bind rejects stale slots and incomplete shared targets", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
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
  await bindBlobAttachment(runtime, {
    blobId,
    fingerprint: owner.fingerprint,
    request: firstBind.request,
    sessionId: "test-session",
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
    bindBlobAttachment(runtime, {
      blobId: staleReplacement.verifiedBinding.blobId,
      fingerprint: owner.fingerprint,
      request: staleReplacement.request,
      sessionId: "test-session",
      userId: owner.userId,
    }),
  ).rejects.toMatchObject(
    new BlobMutationError(
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
    bindBlobAttachment(runtime, {
      blobId,
      fingerprint: owner.fingerprint,
      request: omittedTargetsBind.request,
      sessionId: "test-session",
      userId: owner.userId,
    }),
  ).rejects.toMatchObject(
    new BlobMutationError(
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
  const sharedResponse = await bindBlobAttachment(runtime, {
    blobId,
    fingerprint: owner.fingerprint,
    request: sharedBind.request,
    sessionId: "test-session",
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
