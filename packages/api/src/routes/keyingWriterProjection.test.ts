import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type {
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  DocumentAccessEventBody,
  DocumentLinkAccessEventBody,
  DocumentLinkSetManifestState,
  KeyingCanonicalJson,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeContentRecordNonceDomainHash,
  computeDocumentContentKeyTargetHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  deriveContainerAccessManifest,
  deriveDocumentLinkSetManifest,
  signAccessEvent,
  signWriteHeader,
  toFingerprint,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import {
  createDocument as createLoroDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import type {
  ContainerManifestBundle,
  ContainerMutationRequest,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  type ContainerMutationResponse,
  type DocumentCreateResponse,
  type DocumentLinkSetMutationResponse,
  type DocumentWriterProjectionResponse,
  isContainerMutationResponse,
  isContainerWriterProjectionResponse,
  isDocumentCreateResponse,
  isDocumentLinkSetMutationResponse,
  isDocumentSyncResponse,
  isDocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { and, eq, inArray, isNull } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../test/helpers/authenticate";
import {
  appendUnexpectedUserWrapToRekey,
  buildRootContainerRekeyMutation,
} from "../../test/helpers/containerRekey";
import { registerUser } from "../../test/helpers/registerUser";
import { getAccessManifestBundle } from "../access/read/accessManifestStore";
import {
  getCurrentContainerKeyEpoch,
  listContainerKeyWraps,
} from "../access/read/containerKekStore";
import { db } from "../adapters/postgres";
import { verifyDocumentAuditHistory } from "../documents/verifyDocumentAuditHistory";
import { routeApp } from "../routeApp";
import {
  accessManifestDocumentLinkProjection,
  accessManifests,
  containerDocumentSyncTombstones,
  containerKeyEpochs,
  containers,
  documentAuditCheckpoints,
  documentAuditEntries,
  documentContainerLinks,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documents,
  documentUpdateAuditEvents,
  users,
} from "../schema";

interface RootContainerFixture {
  readonly id: string;
  readonly organizationId: string;
}

interface StoredRootFixture {
  readonly bundle: ContainerManifestBundle;
  readonly kekState: VerifiedContainerKekState;
}

async function getRootContainerForUser(
  userId: string,
): Promise<RootContainerFixture> {
  const [user] = await db
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  invariant(user, "expected user row");

  const [rootContainer] = await db
    .select({ id: containers.id, organizationId: containers.organizationId })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, user.defaultOrganizationId),
        isNull(containers.parentId),
      ),
    )
    .limit(1);

  invariant(rootContainer, "expected root container row");
  return rootContainer;
}

function asVerifiedContainerManifest(
  bundle: ContainerManifestBundle,
): VerifiedContainerAccessManifest {
  return bundle as unknown as VerifiedContainerAccessManifest;
}

async function createSignedAccessEvent(input: {
  readonly body: ContainerAccessEventBody | DocumentAccessEventBody;
  readonly dependencyManifestHashes?: readonly string[];
  readonly objectId: string;
  readonly objectKind: "container" | "document";
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

async function verifyKekState(input: {
  readonly bundle: ContainerManifestBundle;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly userRecipientKeys: readonly ContainerUserRecipientKey[];
  readonly wraps: readonly ContainerKeyWrap[];
}): Promise<VerifiedContainerKekState> {
  const verified = await verifyContainerKekState({
    containerManifest: asVerifiedContainerManifest(input.bundle),
    keyEpoch: input.keyEpoch,
    userRecipientKeys: input.userRecipientKeys,
    wraps: input.wraps,
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
  invariant(keyEpoch, "expected container key epoch");

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

async function userRecipientKey(
  user: TestUser,
): Promise<ContainerUserRecipientKey> {
  const recipientKeyFingerprint = await toFingerprint(user.kem.publicKey);

  return {
    userId: user.userId,
    recipientKeyEpochId: `user:${user.userId}:encapsulation:${recipientKeyFingerprint}`,
    recipientKeyFingerprint,
  };
}

async function bootstrapRoot(owner: TestUser): Promise<StoredRootFixture> {
  const rootContainer = await getRootContainerForUser(owner.userId);
  const storedKeyEpoch = await getCurrentContainerKeyEpoch(
    rootContainer.id,
    db,
  );
  const keyEpoch = toContainerKeyEpoch(storedKeyEpoch);
  const bundle = await getAccessManifestBundle(keyEpoch.accessManifestHash, db);
  invariant(bundle, "expected registered root container manifest");
  const wraps = (await listContainerKeyWraps(keyEpoch.id, db)).map(
    toContainerKeyWrap,
  );
  const ownerWrap = wraps.find(
    (wrap) =>
      wrap.recipientKind === "user" && wrap.recipientId === owner.userId,
  );
  invariant(ownerWrap, "expected registered root user KEK wrap");
  const ownerKey: ContainerUserRecipientKey = {
    userId: owner.userId,
    recipientKeyEpochId: ownerWrap.recipientKeyEpochId,
    recipientKeyFingerprint: ownerWrap.recipientKeyFingerprint,
  };
  const kekState = await verifyKekState({
    bundle: bundle as unknown as ContainerManifestBundle,
    keyEpoch,
    userRecipientKeys: [ownerKey],
    wraps,
  });

  return { bundle: bundle as unknown as ContainerManifestBundle, kekState };
}

function accessManifestFromContainerResponse(
  response: ContainerMutationResponse,
): ContainerManifestBundle {
  return response.accessManifest as unknown as ContainerManifestBundle;
}

function kekStateFromContainerResponse(
  response: ContainerMutationResponse,
): VerifiedContainerKekState {
  return response.containerKek as unknown as VerifiedContainerKekState;
}

async function createContainerManifestBundle(
  state: ContainerAccessManifestState,
  event: VerifiedAccessEvent,
): Promise<ContainerManifestBundle> {
  const manifest = await deriveContainerAccessManifest(state);

  return {
    event: event as unknown as Record<string, unknown>,
    manifest: manifest as unknown as Record<string, unknown>,
    manifestHash: await computeAccessManifestHash(manifest),
    state: state as unknown as Record<string, unknown>,
  };
}

function createContainerKeyEpoch(input: {
  readonly containerKeyEpochId: string;
  readonly keyEpoch: number;
  readonly manifest: ContainerManifestBundle;
  readonly parentKekState: VerifiedContainerKekState;
}): ContainerKeyEpoch {
  const verifiedManifest = asVerifiedContainerManifest(input.manifest);

  return {
    id: input.containerKeyEpochId,
    containerId: verifiedManifest.state.containerId,
    keyEpoch: input.keyEpoch,
    accessManifestHash: verifiedManifest.manifestHash,
    parentContainerKeyEpochId: input.parentKekState.containerKeyEpochId,
    createdByEventHash: verifiedManifest.event.eventHash,
    createdByManifestHash: verifiedManifest.manifestHash,
  };
}

function createRootContainerKeyEpoch(input: {
  readonly containerKeyEpochId: string;
  readonly keyEpoch: number;
  readonly manifest: ContainerManifestBundle;
}): ContainerKeyEpoch {
  const verifiedManifest = asVerifiedContainerManifest(input.manifest);

  return {
    id: input.containerKeyEpochId,
    containerId: verifiedManifest.state.containerId,
    keyEpoch: input.keyEpoch,
    accessManifestHash: verifiedManifest.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: verifiedManifest.event.eventHash,
    createdByManifestHash: verifiedManifest.manifestHash,
  };
}

function createContainerKeyWrap(input: {
  readonly containerKeyEpochId: string;
  readonly parentKekState: VerifiedContainerKekState;
  readonly wrapManifestHash: string;
}): ContainerKeyWrap {
  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: "container",
    recipientId: input.parentKekState.containerId,
    recipientKeyEpochId: input.parentKekState.containerKeyEpochId,
    recipientKeyFingerprint: input.parentKekState.keyEpochHash,
    kemCipherText: `kem:${input.containerKeyEpochId}`,
    wrappedKey: `wrapped:${input.containerKeyEpochId}`,
    wrapManifestHash: input.wrapManifestHash,
  };
}

async function createChildContainer(input: {
  readonly parent: StoredRootFixture;
  readonly signer: TestUser;
}): Promise<ContainerMutationResponse> {
  const containerId = crypto.randomUUID();
  const containerKeyEpochId = crypto.randomUUID();
  const parentManifest = asVerifiedContainerManifest(input.parent.bundle);
  const body: ContainerAccessEventBody = {
    eventType: "container.create",
    parentContainerId: parentManifest.state.containerId,
    parentManifestHash: input.parent.bundle.manifestHash,
    metadataDocumentId: crypto.randomUUID(),
    containerKeyEpochId,
    directGrants: [],
    referencedPrincipalHeads: [],
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [input.parent.bundle.manifestHash],
    objectId: containerId,
    objectKind: "container",
    organizationId: parentManifest.state.organizationId,
    previousManifestHash: null,
    signer: input.signer,
  });
  const bundle = await createContainerManifestBundle(
    {
      version: 1,
      containerId,
      organizationId: parentManifest.state.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash: event.eventHash,
      parentContainerId: parentManifest.state.containerId,
      parentManifestHash: input.parent.bundle.manifestHash,
      metadataDocumentId: body.metadataDocumentId,
      containerKeyEpochId,
      directGrants: [],
      referencedPrincipalHeads: [],
    },
    event,
  );
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: 1,
    manifest: bundle,
    parentKekState: input.parent.kekState,
  });
  const wrap = createContainerKeyWrap({
    containerKeyEpochId,
    parentKekState: input.parent.kekState,
    wrapManifestHash: bundle.manifestHash,
  });
  const request: ContainerMutationRequest = {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    parentContainerPath: [input.parent.bundle],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    wraps: [wrap as unknown as Record<string, unknown>],
    parentKekState: input.parent.kekState as unknown as Record<string, unknown>,
    userRecipientKeys: [],
  };
  const response = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.signer.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(response.status).toBe(200);
  const created = await response.json();
  expect(isContainerMutationResponse(created)).toBe(true);
  return created as ContainerMutationResponse;
}

async function createDocumentRequest(input: {
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<DocumentCreateRequest> {
  const documentId = crypto.randomUUID();
  const body: DocumentLinkAccessEventBody = {
    eventType: "document.link",
    containerId: input.root.kekState.containerId,
    containerManifestHash: input.root.bundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [input.root.bundle.manifestHash],
    objectId: documentId,
    objectKind: "document",
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    previousManifestHash: null,
    signer: input.owner,
  });
  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId,
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
    linkedContainerIds: [input.root.kekState.containerId],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const targets = [
    {
      containerId: input.root.kekState.containerId,
      containerManifestHash: input.root.bundle.manifestHash,
      containerKeyEpochId: input.root.kekState.containerKeyEpochId,
      containerKeyEpoch: input.root.kekState.containerKeyEpoch,
    },
  ];
  const targetHash = await computeDocumentContentKeyTargetHash(targets);

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown as Record<string, unknown>,
    expectedManifestHash: manifestHash,
    manifest: manifest as unknown as Record<string, unknown>,
    targetContainerPath: [
      input.root.bundle as unknown as Record<string, unknown>,
    ],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: targets.map((target) => ({
        ...target,
        wrappedKey: `document-key:${documentId}`,
        wrappingMetadata: { alg: "test-wrap" },
      })),
    },
  };
}

async function createDocument(input: {
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<DocumentCreateResponse> {
  const createResponse = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(await createDocumentRequest(input)),
  });
  expect(createResponse.status).toBe(200);
  const created = await createResponse.json();
  expect(isDocumentCreateResponse(created)).toBe(true);
  return created as DocumentCreateResponse;
}

async function createSignedDocumentSyncRequest(input: {
  readonly created: DocumentCreateResponse;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<{
  readonly request: DocumentSyncRequest;
  readonly updateId: string;
}> {
  const updateId = crypto.randomUUID();
  const document = await createLoroDocument(`sync-audit-${updateId}`);
  const partialStartVersionVector = encodeVersionVector(document);
  document.getText("text").update(`sync audit update ${updateId}`);
  const updateBytes = exportUpdatesSince(document, partialStartVersionVector);
  const vectors = getUpdateVersionVectors(updateBytes);
  const encryptedData = `encrypted-sync-audit-update:${updateId}`;
  const organizationId = String(
    Reflect.get(input.created.accessManifest.state, "organizationId"),
  );
  const writeHeader = await signWriteHeader(
    {
      version: 1,
      organizationId,
      objectKind: "document",
      objectId: input.created.id,
      accessManifestHash: input.created.contentKeyBundle.linkSetManifestHash,
      contentKeyEpoch: input.created.contentKeyBundle.contentKeyEpoch,
      targetHash: input.created.contentKeyBundle.targetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId: updateId,
      nonceDomainHash: await computeContentRecordNonceDomainHash({
        version: 1,
        organizationId,
        objectKind: "document",
        objectId: input.created.id,
        contentKeyEpoch: input.created.contentKeyBundle.contentKeyEpoch,
        encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
        contentRecordId: updateId,
      }),
      metadataHash: await computeDocumentContentRecordMetadataHash({
        documentId: input.created.id,
        partialEndVersionVector: vectors.partialEndVersionVector,
        partialStartVersionVector: vectors.partialStartVersionVector,
        updateId,
      }),
      ciphertextHash:
        await computeDocumentContentRecordCiphertextHash(encryptedData),
      writerUserId: input.owner.userId,
      writerDeviceId: "test-device",
      writerKeyFingerprint: input.owner.fingerprint,
      signedAt: "2026-04-27T12:00:00.000Z",
    },
    input.owner.signing.signingPrivateKey,
  );

  return {
    updateId,
    request: {
      contentKeyEpoch: input.created.contentKeyBundle.contentKeyEpoch,
      documentManifest: input.created.accessManifest,
      expectedLinkSetManifestHash:
        input.created.contentKeyBundle.linkSetManifestHash,
      expectedTargetHash: input.created.contentKeyBundle.targetHash,
      authorizingContainerPaths: [
        [input.root.bundle as unknown as Record<string, unknown>],
      ],
      localVersionVector: null,
      outgoingUpdates: [
        {
          checkpointKind: "fresh_baseline",
          encryptedData,
          id: updateId,
          partialStartVersionVector: vectors.partialStartVersionVector,
          partialEndVersionVector: vectors.partialEndVersionVector,
          sourceVersionVector: partialStartVersionVector,
          writeHeader: writeHeader as unknown as Record<string, unknown>,
        },
      ],
    },
  };
}

async function countDocumentAuditRows(documentId: string, updateId: string) {
  const [auditEntries, updateEvents, checkpoints] = await Promise.all([
    db
      .select({
        entryHash: documentAuditEntries.entryHash,
        id: documentAuditEntries.id,
      })
      .from(documentAuditEntries)
      .where(eq(documentAuditEntries.documentId, documentId)),
    db
      .select({ liveUpdateId: documentUpdateAuditEvents.liveUpdateId })
      .from(documentUpdateAuditEvents)
      .where(eq(documentUpdateAuditEvents.liveUpdateId, updateId)),
    db
      .select({
        baselineUpdateId: documentAuditCheckpoints.baselineUpdateId,
        coveredAuditEntryHash: documentAuditCheckpoints.coveredAuditEntryHash,
      })
      .from(documentAuditCheckpoints)
      .where(eq(documentAuditCheckpoints.baselineUpdateId, updateId)),
  ]);

  return { auditEntries, checkpoints, updateEvents };
}

async function buildRootGrantRequest(input: {
  readonly previous: ContainerManifestBundle;
  readonly previousKekState: VerifiedContainerKekState;
  readonly recipient: TestUser;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const signerKey = await userRecipientKey(input.signer);
  const recipientKey = await userRecipientKey(input.recipient);
  const grant = {
    subjectType: "user" as const,
    subjectId: input.recipient.userId,
    accessLevel: "write" as const,
  };
  const body: ContainerAccessEventBody = {
    eventType: "container.grant",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    grant,
    referencedPrincipalHead: null,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [input.previous.manifestHash],
    objectId: previous.state.containerId,
    objectKind: "container",
    organizationId: previous.state.organizationId,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createContainerManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.previous.manifestHash,
      eventHash: event.eventHash,
      directGrants: [...previous.state.directGrants, grant],
    },
    event,
  );
  const wraps = [
    ...(input.previousKekState.wraps as readonly ContainerKeyWrap[]),
    {
      containerKeyEpochId: input.previousKekState.containerKeyEpochId,
      recipientKind: "user" as const,
      recipientId: recipientKey.userId,
      recipientKeyEpochId: recipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: recipientKey.recipientKeyFingerprint,
      kemCipherText: `kem:${input.previousKekState.containerKeyEpochId}:${recipientKey.userId}`,
      wrappedKey: `wrapped:${input.previousKekState.containerKeyEpochId}:${recipientKey.userId}`,
      wrapManifestHash: bundle.manifestHash,
    },
  ];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [input.previous],
    containerManifestHistory: [input.previous],
    keyEpoch: input.previousKekState.keyEpoch as unknown as Record<
      string,
      unknown
    >,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: null,
    userRecipientKeys: [
      signerKey as unknown as Record<string, unknown>,
      recipientKey as unknown as Record<string, unknown>,
    ],
  };
}

async function buildRootRevokeRequest(input: {
  readonly previous: ContainerManifestBundle;
  readonly previousKekState: VerifiedContainerKekState;
  readonly revokedUser: TestUser;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const signerKey = await userRecipientKey(input.signer);
  const containerKeyEpochId = crypto.randomUUID();
  const body: ContainerAccessEventBody = {
    eventType: "container.revoke",
    containerKeyEpochId,
    subjectType: "user",
    subjectId: input.revokedUser.userId,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [input.previous.manifestHash],
    objectId: previous.state.containerId,
    objectKind: "container",
    organizationId: previous.state.organizationId,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createContainerManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.previous.manifestHash,
      eventHash: event.eventHash,
      containerKeyEpochId,
      directGrants: previous.state.directGrants.filter(
        (grant) =>
          grant.subjectType !== "user" ||
          grant.subjectId !== input.revokedUser.userId,
      ),
    },
    event,
  );
  const keyEpoch = createRootContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: input.previousKekState.containerKeyEpoch + 1,
    manifest: bundle,
  });
  const wraps: ContainerKeyWrap[] = [
    {
      containerKeyEpochId,
      recipientKind: "user",
      recipientId: signerKey.userId,
      recipientKeyEpochId: signerKey.recipientKeyEpochId,
      recipientKeyFingerprint: signerKey.recipientKeyFingerprint,
      kemCipherText: `kem:${containerKeyEpochId}:${signerKey.userId}`,
      wrappedKey: `wrapped:${containerKeyEpochId}:${signerKey.userId}`,
      wrapManifestHash: bundle.manifestHash,
    },
  ];
  const kekState = await verifyKekState({
    bundle,
    keyEpoch,
    userRecipientKeys: [signerKey],
    wraps,
  });

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [input.previous],
    containerManifestHistory: [input.previous],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    wraps: kekState.wraps as unknown as Record<string, unknown>[],
    parentKekState: null,
    userRecipientKeys: [signerKey as unknown as Record<string, unknown>],
  };
}

test("POST /documents rejects malformed signed event records", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await createDocumentRequest({ owner, root });

  request.event = {
    ...request.event,
    version: "2",
  };

  const response = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Document event.version is invalid",
  });
});

test("POST /documents applies optional container rekeys before target validation", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const rootRekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const request = await createDocumentRequest({
    owner,
    root: {
      bundle: rootRekey.bundle,
      kekState: rootRekey.kekState,
    },
  });
  request.containerRekeys = [rootRekey.request];

  const response = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(response.status).toBe(200);
  const created = await response.json();
  expect(isDocumentCreateResponse(created)).toBe(true);
  expect(created.documentKekTargets.linkedContainerKeyEpochIds).toEqual([
    rootRekey.kekState.containerKeyEpochId,
  ]);

  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    root.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(rootRekey.kekState.containerKeyEpochId);

  const projectionResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(projectionResponse.status).toBe(200);
  const projection = await projectionResponse.json();
  expect(isContainerWriterProjectionResponse(projection)).toBe(true);
  expect(
    projection.containerKeks[0]?.containerManifestHistory?.map(
      (entry: { manifestHash: string }) => entry.manifestHash,
    ),
  ).toEqual([root.bundle.manifestHash]);
});

async function buildDocumentLinkRequest(input: {
  readonly child: ContainerMutationResponse;
  readonly createdDocument: Awaited<ReturnType<typeof createDocument>>;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<DocumentLinkSetMutationRequest> {
  const childBundle = accessManifestFromContainerResponse(input.child);
  const childKek = kekStateFromContainerResponse(input.child);
  const previousState = input.createdDocument.accessManifest.state;
  const documentId = input.createdDocument.id;
  const body: DocumentLinkAccessEventBody = {
    eventType: "document.link",
    containerId: input.child.containerId,
    containerManifestHash: childBundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      input.root.bundle.manifestHash,
      childBundle.manifestHash,
    ],
    objectId: documentId,
    objectKind: "document",
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    previousManifestHash: input.createdDocument.accessManifest.manifestHash,
    signer: input.owner,
  });
  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId,
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    epoch:
      typeof Reflect.get(previousState, "epoch") === "number"
        ? Number(Reflect.get(previousState, "epoch")) + 1
        : 2,
    previousManifestHash: input.createdDocument.accessManifest.manifestHash,
    eventHash: event.eventHash,
    linkedContainerIds: [
      input.root.kekState.containerId,
      input.child.containerId,
    ],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const targets = [
    ...input.createdDocument.documentKekTargets.targets.map((target) => ({
      containerId: String(Reflect.get(target, "containerId")),
      containerManifestHash: String(
        Reflect.get(target, "containerManifestHash"),
      ),
      containerKeyEpochId: String(Reflect.get(target, "containerKeyEpochId")),
      containerKeyEpoch: Number(Reflect.get(target, "containerKeyEpoch")),
    })),
    {
      containerId: input.child.containerId,
      containerManifestHash: childBundle.manifestHash,
      containerKeyEpochId: childKek.containerKeyEpochId,
      containerKeyEpoch: childKek.containerKeyEpoch,
    },
  ];
  const targetHash = await computeDocumentContentKeyTargetHash(targets);

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown as Record<string, unknown>,
    expectedManifestHash: manifestHash,
    manifest: manifest as unknown as Record<string, unknown>,
    previousManifest: input.createdDocument.accessManifest,
    targetContainerPath: [
      input.root.bundle as unknown as Record<string, unknown>,
      childBundle as unknown as Record<string, unknown>,
    ],
    authorizingContainerPaths: [
      [input.root.bundle as unknown as Record<string, unknown>],
    ],
    contentKeyBundle: {
      contentKeyEpoch: input.createdDocument.contentKeyBundle.contentKeyEpoch,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: [
        ...input.createdDocument.contentKeyBundle.targets,
        {
          containerId: input.child.containerId,
          containerManifestHash: childBundle.manifestHash,
          containerKeyEpochId: childKek.containerKeyEpochId,
          containerKeyEpoch: childKek.containerKeyEpoch,
          wrappedKey: `document-key:${documentId}:child`,
          wrappingMetadata: { alg: "test-wrap" },
        },
      ],
    },
  };
}

async function buildDocumentUnlinkRequest(input: {
  readonly child: ContainerMutationResponse;
  readonly linkedDocument: DocumentLinkSetMutationResponse;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<DocumentLinkSetMutationRequest> {
  const childBundle = accessManifestFromContainerResponse(input.child);
  const previousState = input.linkedDocument.accessManifest.state;
  const documentId = input.linkedDocument.id;
  const body: DocumentAccessEventBody = {
    eventType: "document.unlink",
    containerId: input.child.containerId,
    containerManifestHash: childBundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      input.root.bundle.manifestHash,
      childBundle.manifestHash,
    ],
    objectId: documentId,
    objectKind: "document",
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    previousManifestHash: input.linkedDocument.accessManifest.manifestHash,
    signer: input.owner,
  });
  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId,
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    epoch:
      typeof Reflect.get(previousState, "epoch") === "number"
        ? Number(Reflect.get(previousState, "epoch")) + 1
        : 3,
    previousManifestHash: input.linkedDocument.accessManifest.manifestHash,
    eventHash: event.eventHash,
    linkedContainerIds: [input.root.kekState.containerId],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const remainingTarget = {
    containerId: input.root.kekState.containerId,
    containerManifestHash: input.root.bundle.manifestHash,
    containerKeyEpochId: input.root.kekState.containerKeyEpochId,
    containerKeyEpoch: input.root.kekState.containerKeyEpoch,
  };
  const targetHash = await computeDocumentContentKeyTargetHash([
    remainingTarget,
  ]);

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown as Record<string, unknown>,
    expectedManifestHash: manifestHash,
    manifest: manifest as unknown as Record<string, unknown>,
    previousManifest: input.linkedDocument.accessManifest,
    targetContainerPath: [
      input.root.bundle as unknown as Record<string, unknown>,
      childBundle as unknown as Record<string, unknown>,
    ],
    authorizingContainerPaths: [
      [input.root.bundle as unknown as Record<string, unknown>],
    ],
    contentKeyBundle: {
      contentKeyEpoch:
        input.linkedDocument.contentKeyBundle.contentKeyEpoch + 1,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: [
        {
          ...remainingTarget,
          wrappedKey: `document-key:${documentId}:rotated-root`,
          wrappingMetadata: { alg: "test-wrap" },
        },
      ],
    },
  };
}

test("GET /containers/:containerId/writer-projection returns signed path and KEK projection", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(isContainerWriterProjectionResponse(body)).toBe(true);
  expect(body.containerId).toBe(root.kekState.containerId);
  expect(
    body.path.map((entry: { manifestHash: string }) => entry.manifestHash),
  ).toEqual([root.bundle.manifestHash]);
  expect(body.path[0].event.eventHash).toBe(
    asVerifiedContainerManifest(root.bundle).event.eventHash,
  );
  expect(body.path[0].event.body.eventType).toBe("container.create");
  expect(body.containerKeks).toHaveLength(1);
  expect(body.containerKeks[0].containerKeyEpochId).toBe(
    root.kekState.containerKeyEpochId,
  );
});

test("GET /containers/:containerId/writer-projection verifies inherited parent KEK edges", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });

  const response = await routeApp.request(
    `/containers/${child.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(isContainerWriterProjectionResponse(body)).toBe(true);
  expect(
    body.path.map((entry: { manifestHash: string }) => entry.manifestHash),
  ).toEqual([root.bundle.manifestHash, child.accessManifest.manifestHash]);
  expect(body.containerKeks).toHaveLength(2);
  expect(body.containerKeks[1].parentContainerKeyEpochId).toBe(
    root.kekState.containerKeyEpochId,
  );
});

test("GET /containers/:containerId/writer-projection rejects users without write access", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(outsider);
  await authenticate(outsider);
  const root = await bootstrapRoot(owner);

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${outsider.token}`,
      },
    },
  );

  expect(response.status).toBe(403);
});

test("GET /containers/:containerId/writer-projection rejects malformed stored state", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);

  await db
    .update(accessManifests)
    .set({
      state: {
        ...root.bundle.state,
        version: 2,
      } as KeyingCanonicalJson,
    })
    .where(eq(accessManifests.manifestHash, root.bundle.manifestHash));

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(409);
});

test("GET /containers/:containerId/writer-projection rejects tampered stored KEK state", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);

  await db
    .update(containerKeyEpochs)
    .set({
      accessManifestHash: "0".repeat(64),
    })
    .where(eq(containerKeyEpochs.id, root.kekState.containerKeyEpochId));

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(409);
});

test("GET /documents/:documentId/writer-projection returns document targets and authorizing paths", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(200);
  const projection = await projectionResponse.json();
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  expect(projection.documentId).toBe(created.id);
  expect(projection.documentManifest.manifestHash).toBe(
    created.accessManifest.manifestHash,
  );
  expect(projection.documentManifest.event.eventHash).toBe(
    Reflect.get(created.accessManifest.event, "eventHash"),
  );
  expect(projection.documentManifest.event.body.eventType).toBe(
    "document.link",
  );
  expect(projection.documentKekTargets.documentKeyTargetHash).toBe(
    created.documentKekTargets.documentKeyTargetHash,
  );
  expect(projection.contentKeyBundle.targetHash).toBe(
    created.contentKeyBundle.targetHash,
  );
  expect(projection.authorizingContainerPaths).toHaveLength(1);
});

test("GET /documents/:documentId/writer-projection blocks revoked users after root KEK rotation", async () => {
  const owner = createTestUser();
  const recipient = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(recipient);
  await authenticate(recipient);
  const root = await bootstrapRoot(owner);
  const grantRequest = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient,
    signer: owner,
  });

  const shareResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(grantRequest),
    },
  );
  expect(shareResponse.status).toBe(200);
  const shared = await shareResponse.json();
  expect(isContainerMutationResponse(shared)).toBe(true);

  const recipientSharedProjectionResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${recipient.token}`,
      },
    },
  );
  expect(recipientSharedProjectionResponse.status).toBe(200);

  const revokeRequest = await buildRootRevokeRequest({
    previous: accessManifestFromContainerResponse(shared),
    previousKekState: kekStateFromContainerResponse(shared),
    revokedUser: recipient,
    signer: owner,
  });
  const revokeResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/revoke`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(revokeRequest),
    },
  );
  expect(revokeResponse.status).toBe(200);
  const revoked = await revokeResponse.json();
  expect(isContainerMutationResponse(revoked)).toBe(true);
  expect(revoked.containerKek.containerKeyEpochId).not.toBe(
    shared.containerKek.containerKeyEpochId,
  );

  const created = await createDocument({
    owner,
    root: {
      bundle: accessManifestFromContainerResponse(revoked),
      kekState: kekStateFromContainerResponse(revoked),
    },
  });
  expect(created.documentKekTargets.linkedContainerKeyEpochIds).toEqual([
    revoked.containerKek.containerKeyEpochId,
  ]);
  expect(created.documentKekTargets.targets).toEqual([
    expect.objectContaining({
      containerId: root.kekState.containerId,
      containerKeyEpoch: revoked.containerKek.containerKeyEpoch,
      containerKeyEpochId: revoked.containerKek.containerKeyEpochId,
    }),
  ]);

  const ownerProjectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(ownerProjectionResponse.status).toBe(200);
  const ownerProjection = await ownerProjectionResponse.json();
  expect(isDocumentWriterProjectionResponse(ownerProjection)).toBe(true);
  expect(ownerProjection.contentKeyBundle.targets).toEqual([
    expect.objectContaining({
      containerId: root.kekState.containerId,
      containerKeyEpochId: revoked.containerKek.containerKeyEpochId,
    }),
  ]);

  const recipientProjectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${recipient.token}`,
      },
    },
  );
  expect(recipientProjectionResponse.status).toBe(403);
});

test("POST /documents/:documentId/sync writes audit rows for accepted live updates", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request, updateId } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const preSyncUpdatedAt = new Date("2026-05-05T00:00:00.000Z");
  await Promise.all([
    db
      .update(documents)
      .set({ updatedAt: preSyncUpdatedAt })
      .where(eq(documents.id, created.id)),
    db
      .update(containers)
      .set({ updatedAt: preSyncUpdatedAt })
      .where(eq(containers.id, root.kekState.containerId)),
  ]);

  const syncResponse = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  expect(syncResponse.status).toBe(200);
  const synced = await syncResponse.json();
  expect(isDocumentSyncResponse(synced)).toBe(true);
  expect(synced.acceptedOutgoingUpdateIds).toEqual([updateId]);
  const [[syncedDocumentRow], [syncedContainerRow]] = await Promise.all([
    db
      .select({ updatedAt: documents.updatedAt })
      .from(documents)
      .where(eq(documents.id, created.id))
      .limit(1),
    db
      .select({ updatedAt: containers.updatedAt })
      .from(containers)
      .where(eq(containers.id, root.kekState.containerId))
      .limit(1),
  ]);
  invariant(syncedDocumentRow, "expected synced document row");
  invariant(syncedContainerRow, "expected synced container row");
  expect(syncedDocumentRow.updatedAt.toISOString()).not.toBe(
    preSyncUpdatedAt.toISOString(),
  );
  expect(syncedContainerRow.updatedAt.toISOString()).toBe(
    syncedDocumentRow.updatedAt.toISOString(),
  );

  const retryResponse = await routeApp.request(
    `/documents/${created.id}/sync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  expect(retryResponse.status).toBe(200);
  const retried = await retryResponse.json();
  expect(isDocumentSyncResponse(retried)).toBe(true);
  expect(retried.acceptedOutgoingUpdateIds).toEqual([updateId]);

  const { auditEntries, checkpoints, updateEvents } =
    await countDocumentAuditRows(created.id, updateId);
  expect(auditEntries).toHaveLength(1);
  expect(updateEvents).toEqual([{ liveUpdateId: updateId }]);
  expect(checkpoints).toHaveLength(1);
  expect(checkpoints[0]?.coveredAuditEntryHash).toBe(
    auditEntries[0]?.entryHash,
  );

  const auditHistory = await verifyDocumentAuditHistory(db, {
    documentId: created.id,
  });
  expect(auditHistory).toMatchObject({
    attachmentEventCount: 0,
    auditEntryCount: 1,
    checkpointCount: 1,
    isValid: true,
    updateEventCount: 1,
  });
});

test("POST /documents/:documentId/sync rolls back optional rekeys when write validation fails", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  request.containerRekeys = [rekey.request];

  const syncResponse = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(syncResponse.status).toBe(409);
  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    root.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(root.kekState.containerKeyEpochId);
});

test("POST /documents/:documentId/sync rejects invalid optional container rekeys", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  appendUnexpectedUserWrapToRekey(rekey.request);
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  request.containerRekeys = [rekey.request];

  const syncResponse = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(syncResponse.status).toBe(409);
  expect(await syncResponse.json()).toEqual({
    error: "container key wrap is not justified by its manifest",
  });
  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    root.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(root.kekState.containerKeyEpochId);
});

test("GET /documents/:documentId/writer-projection refreshes same-epoch root share targets", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const recipient = createTestUser();
  await registerUser(recipient);
  await authenticate(recipient);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const shareRequest = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient,
    signer: owner,
  });
  const shareResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(shareRequest),
    },
  );

  expect(shareResponse.status).toBe(200);
  const shared = await shareResponse.json();
  expect(isContainerMutationResponse(shared)).toBe(true);
  const [storedBundleBeforeProjection] = await db
    .select({
      linkSetManifestHash: documentContentKeyEpochs.linkSetManifestHash,
      targetHash: documentContentKeyEpochs.targetHash,
    })
    .from(documentContentKeyEpochs)
    .where(
      and(
        eq(documentContentKeyEpochs.documentId, created.id),
        eq(
          documentContentKeyEpochs.contentKeyEpoch,
          created.contentKeyBundle.contentKeyEpoch,
        ),
      ),
    )
    .limit(1);
  invariant(storedBundleBeforeProjection, "expected content-key bundle row");
  expect(storedBundleBeforeProjection.targetHash).toBe(
    created.contentKeyBundle.targetHash,
  );

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${recipient.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(200);
  const projection = await projectionResponse.json();
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  expect(projection.contentKeyBundle.contentKeyEpoch).toBe(
    created.contentKeyBundle.contentKeyEpoch,
  );
  expect(projection.documentKekTargets.documentKeyTargetHash).toBe(
    projection.contentKeyBundle.targetHash,
  );
  expect(projection.contentKeyBundle.targetHash).not.toBe(
    storedBundleBeforeProjection.targetHash,
  );
  expect(projection.documentKekTargets.linkedContainerManifestHashes).toEqual([
    shared.manifestHead.manifestHash,
  ]);
  expect(projection.contentKeyBundle.targets).toEqual([
    {
      ...created.contentKeyBundle.targets[0],
      containerManifestHash: shared.manifestHead.manifestHash,
    },
  ]);
  expect(projection.authorizingContainerPaths).toHaveLength(1);
  expect(
    projection.authorizingContainerPaths[0]?.containerKeks[0]?.containerManifestHistory?.map(
      (entry: { manifestHash: string }) => entry.manifestHash,
    ),
  ).toEqual([root.bundle.manifestHash]);

  const [storedBundleAfterProjection] = await db
    .select({
      linkSetManifestHash: documentContentKeyEpochs.linkSetManifestHash,
      targetHash: documentContentKeyEpochs.targetHash,
    })
    .from(documentContentKeyEpochs)
    .where(
      and(
        eq(documentContentKeyEpochs.documentId, created.id),
        eq(
          documentContentKeyEpochs.contentKeyEpoch,
          created.contentKeyBundle.contentKeyEpoch,
        ),
      ),
    )
    .limit(1);
  expect(storedBundleAfterProjection).toEqual(storedBundleBeforeProjection);
});

test("GET /documents/:documentId/writer-projection rejects tampered content-key targets", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const [contentKeyEpoch] = await db
    .select({ id: documentContentKeyEpochs.id })
    .from(documentContentKeyEpochs)
    .where(eq(documentContentKeyEpochs.documentId, created.id))
    .limit(1);
  invariant(contentKeyEpoch, "expected document content-key epoch");

  await db
    .update(documentContentKeyTargets)
    .set({
      containerKeyEpochId: "tampered-container-key-epoch",
    })
    .where(
      eq(
        documentContentKeyTargets.documentContentKeyEpochId,
        contentKeyEpoch.id,
      ),
    );

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(409);
});

test("GET /documents/:documentId/writer-projection rejects stale document KEK targets", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  await db.insert(accessManifestDocumentLinkProjection).values({
    containerId: crypto.randomUUID(),
    documentId: created.id,
    manifestHash: created.accessManifest.manifestHash,
  });

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(409);
  expect(await projectionResponse.json()).toEqual({
    error: "Container manifest head missing",
  });
});

test("GET /documents/:documentId/writer-projection rejects malformed stored document state", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  await db
    .update(accessManifests)
    .set({
      state: {
        ...created.accessManifest.state,
        linkedContainerIds: "not-linked-container-ids",
      } as KeyingCanonicalJson,
    })
    .where(
      eq(accessManifests.manifestHash, created.accessManifest.manifestHash),
    );

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(409);
});

test("POST /documents/:documentId/link advances a signed link-set manifest", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const request = await buildDocumentLinkRequest({
    child,
    createdDocument,
    owner,
    root,
  });

  const response = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );

  expect(response.status).toBe(200);
  const linked = await response.json();
  expect(isDocumentLinkSetMutationResponse(linked)).toBe(true);
  expect(linked.accessManifest.manifestHash).toBe(request.expectedManifestHash);
  expect(linked.accessManifest.event.body.eventType).toBe("document.link");
  expect(linked.documentKekTargets.targets).toHaveLength(2);
  expect(linked.contentKeyBundle.targets).toHaveLength(2);

  const rows = await db
    .select({ containerId: documentContainerLinks.containerId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, createdDocument.id));
  expect(rows.map((row) => row.containerId).sort()).toEqual(
    [root.kekState.containerId, child.containerId].sort(),
  );
});

test("GET /documents/:documentId/writer-projection returns multi-linked container paths", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const linkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await buildDocumentLinkRequest({
          child,
          createdDocument,
          owner,
          root,
        }),
      ),
    },
  );
  expect(linkResponse.status).toBe(200);
  const linked = await linkResponse.json();
  expect(isDocumentLinkSetMutationResponse(linked)).toBe(true);

  const projectionResponse = await routeApp.request(
    `/documents/${createdDocument.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(200);
  const projection = await projectionResponse.json();
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  const writerProjection = projection as DocumentWriterProjectionResponse;
  expect(
    writerProjection.documentManifestHistory?.map(
      (bundle) => bundle.manifestHash,
    ),
  ).toEqual([createdDocument.accessManifest.manifestHash]);
  expect(
    new Map(
      writerProjection.documentManifestContainerPaths?.map((path) => [
        path.at(-1)?.manifestHash,
        path.map((bundle) => bundle.manifestHash),
      ]),
    ),
  ).toEqual(
    new Map([
      [root.bundle.manifestHash, [root.bundle.manifestHash]],
      [
        child.accessManifest.manifestHash,
        [root.bundle.manifestHash, child.accessManifest.manifestHash],
      ],
    ]),
  );
  expect(writerProjection.documentKekTargets.targets).toHaveLength(2);
  const pathsByContainerId = new Map(
    writerProjection.authorizingContainerPaths.map((path) => [
      path.containerId,
      path.path.map((entry) => entry.manifestHash),
    ]),
  );
  expect(pathsByContainerId).toEqual(
    new Map([
      [root.kekState.containerId, [root.bundle.manifestHash]],
      [
        child.containerId,
        [root.bundle.manifestHash, child.accessManifest.manifestHash],
      ],
    ]),
  );
});

test("POST /documents/:documentId/link rejects stale previous manifests", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const staleRequest = await buildDocumentLinkRequest({
    child,
    createdDocument,
    owner,
    root,
  });
  const linkedResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(staleRequest),
    },
  );
  expect(linkedResponse.status).toBe(200);

  const nextChild = await createChildContainer({
    parent: root,
    signer: owner,
  });
  const staleSecondRequest = await buildDocumentLinkRequest({
    child: nextChild,
    createdDocument,
    owner,
    root,
  });
  const staleResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(staleSecondRequest),
    },
  );

  expect(staleResponse.status).toBe(409);
  expect(await staleResponse.json()).toEqual({
    error: "Document manifest is stale",
  });
});

test("POST /documents/:documentId/unlink advances a signed link-set manifest", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument,
    owner,
    root,
  });
  const linkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(linkRequest),
    },
  );
  expect(linkResponse.status).toBe(200);
  const linkedDocument = await linkResponse.json();
  expect(isDocumentLinkSetMutationResponse(linkedDocument)).toBe(true);
  const preUnlinkUpdatedAt = new Date("2026-05-05T00:00:00.000Z");
  await db
    .update(documents)
    .set({ updatedAt: preUnlinkUpdatedAt })
    .where(eq(documents.id, createdDocument.id));
  await db
    .update(containers)
    .set({ updatedAt: preUnlinkUpdatedAt })
    .where(
      inArray(containers.id, [root.kekState.containerId, child.containerId]),
    );

  const unlinkRequest = await buildDocumentUnlinkRequest({
    child,
    linkedDocument,
    owner,
    root,
  });
  const unlinkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(unlinkRequest),
    },
  );

  expect(unlinkResponse.status).toBe(200);
  const unlinked = await unlinkResponse.json();
  expect(isDocumentLinkSetMutationResponse(unlinked)).toBe(true);
  expect(unlinked.accessManifest.manifestHash).toBe(
    unlinkRequest.expectedManifestHash,
  );
  expect(unlinked.accessManifest.event.body.eventType).toBe("document.unlink");
  expect(unlinked.documentKekTargets.targets).toHaveLength(1);
  expect(unlinked.documentKekTargets.targets[0].containerId).toBe(
    root.kekState.containerId,
  );
  expect(unlinked.contentKeyBundle.contentKeyEpoch).toBe(
    linkedDocument.contentKeyBundle.contentKeyEpoch + 1,
  );

  const rows = await db
    .select({ containerId: documentContainerLinks.containerId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, createdDocument.id));
  expect(rows.map((row) => row.containerId)).toEqual([
    root.kekState.containerId,
  ]);

  const [documentRow] = await db
    .select({ updatedAt: documents.updatedAt })
    .from(documents)
    .where(eq(documents.id, createdDocument.id))
    .limit(1);
  const touchedContainerRows = await db
    .select({
      id: containers.id,
      updatedAt: containers.updatedAt,
    })
    .from(containers)
    .where(
      inArray(containers.id, [root.kekState.containerId, child.containerId]),
    );
  const [tombstoneRow] = await db
    .select({
      containerId: containerDocumentSyncTombstones.containerId,
      documentId: containerDocumentSyncTombstones.documentId,
      updatedAt: containerDocumentSyncTombstones.updatedAt,
    })
    .from(containerDocumentSyncTombstones)
    .where(
      and(
        eq(containerDocumentSyncTombstones.containerId, child.containerId),
        eq(containerDocumentSyncTombstones.documentId, createdDocument.id),
      ),
    )
    .limit(1);
  invariant(documentRow, "expected touched document row");
  const unlinkUpdatedAt = documentRow.updatedAt.toISOString();
  expect(unlinkUpdatedAt).not.toBe(preUnlinkUpdatedAt.toISOString());
  expect(
    touchedContainerRows.map((row) => [row.id, row.updatedAt.toISOString()]),
  ).toEqual(
    expect.arrayContaining([
      [root.kekState.containerId, unlinkUpdatedAt],
      [child.containerId, unlinkUpdatedAt],
    ]),
  );
  expect(tombstoneRow).toEqual({
    containerId: child.containerId,
    documentId: createdDocument.id,
    updatedAt: documentRow.updatedAt,
  });
});

test("POST /documents/:documentId/unlink rejects removing the final signed link", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const createdDocument = await createDocument({ owner, root });
  const body: DocumentAccessEventBody = {
    eventType: "document.unlink",
    containerId: root.kekState.containerId,
    containerManifestHash: root.bundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [root.bundle.manifestHash],
    objectId: createdDocument.id,
    objectKind: "document",
    organizationId: asVerifiedContainerManifest(root.bundle).state
      .organizationId,
    previousManifestHash: createdDocument.accessManifest.manifestHash,
    signer: owner,
  });
  const request: DocumentLinkSetMutationRequest = {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown as Record<string, unknown>,
    expectedManifestHash: createdDocument.accessManifest.manifestHash,
    manifest: createdDocument.accessManifest.manifest,
    previousManifest: createdDocument.accessManifest,
    targetContainerPath: [root.bundle as unknown as Record<string, unknown>],
    authorizingContainerPaths: [
      [root.bundle as unknown as Record<string, unknown>],
    ],
    contentKeyBundle: {
      contentKeyEpoch: createdDocument.contentKeyBundle.contentKeyEpoch,
      linkSetManifestHash: createdDocument.accessManifest.manifestHash,
      targetHash: createdDocument.contentKeyBundle.targetHash,
      targets: createdDocument.contentKeyBundle.targets,
    },
  };

  const response = await routeApp.request(
    `/documents/${createdDocument.id}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "document.unlink must leave at least one linked container",
  });
});
