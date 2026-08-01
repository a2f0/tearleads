import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifests,
  attachmentBindings,
  blobAuditObjects,
  blobs,
  containerDocumentSyncTombstones,
  containers,
  documentAttachmentAuditEvents,
  documentAuditEntries,
  documentContainerLinks,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documentContentWriteHeaders,
  documents,
  documentUpdates,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type {
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  DocumentAccessEventBody,
  DocumentLinkAccessEventBody,
  DocumentLinkSetManifestState,
  KeyingCanonicalJson,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeDocumentContentKeyTargetHash,
  deriveContainerAccessManifest,
  deriveDocumentLinkSetManifest,
  signAccessEvent,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
} from "@tearleads/validators/request";
import {
  type ContainerMutationResponse,
  type DocumentCreateResponse,
  isContainerMutationResponse,
  isDocumentCreateResponse,
  isDocumentLinkSetMutationResponse,
  isDocumentPurgeResponse,
} from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  readBlobObjectText,
  uploadBlobObject,
} from "../../../test/helpers/blobObjectStore";
import { createTestContainerKekId } from "../../../test/helpers/containerKekMaterial";
import { loadVerifiedPrincipalPolicy } from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { createFailingRuntime } from "../../../test/helpers/serviceRuntime";
import { getAccessManifestBundle } from "../../access/read/accessManifestStore";
import {
  getCurrentContainerKeyEpoch,
  listContainerKeyWraps,
} from "../../access/read/containerKekStore";
import { createRouteApp, routeApp } from "../../routeApp";
import { getDefaultApiServiceRuntime } from "../../services/runtime";

interface RootContainerFixture {
  readonly adminGroupId: string;
  readonly id: string;
  readonly organizationId: string;
}

interface StoredRootFixture {
  readonly bundle: AccessManifestBundleWire;
  readonly kekState: VerifiedContainerKekState;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
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

  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, rootContainer.organizationId))
    .limit(1);
  invariant(organization, "expected registered organization");

  return { ...rootContainer, adminGroupId: organization.adminGroupId };
}

function asVerifiedContainerManifest(
  bundle: AccessManifestBundleWire,
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
  readonly bundle: AccessManifestBundleWire;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly wraps: readonly ContainerKeyWrap[];
}): Promise<VerifiedContainerKekState> {
  const verified = await verifyContainerKekState({
    containerManifest: asVerifiedContainerManifest(input.bundle),
    keyEpoch: input.keyEpoch,
    principalPolicies: input.principalPolicies ?? [],
    userRecipientKeys: [],
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
  const adminPolicy = await loadVerifiedPrincipalPolicy(
    db,
    "group",
    rootContainer.adminGroupId,
  );
  const kekState = await verifyKekState({
    bundle: bundle as unknown as AccessManifestBundleWire,
    keyEpoch,
    principalPolicies: [adminPolicy],
    wraps,
  });

  return {
    bundle: bundle as unknown as AccessManifestBundleWire,
    kekState,
    principalPolicies: [adminPolicy],
  };
}

function accessManifestFromContainerResponse(
  response: ContainerMutationResponse,
): AccessManifestBundleWire {
  return response.accessManifest as unknown as AccessManifestBundleWire;
}

function kekStateFromContainerResponse(
  response: ContainerMutationResponse,
): VerifiedContainerKekState {
  return response.containerKek as unknown as VerifiedContainerKekState;
}

async function createContainerManifestBundle(
  state: ContainerAccessManifestState,
  event: VerifiedAccessEvent,
): Promise<AccessManifestBundleWire> {
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
  readonly manifest: AccessManifestBundleWire;
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

async function loadPrincipalPoliciesForContainerPath(
  path: readonly AccessManifestBundleWire[],
): Promise<VerifiedPrincipalPolicy[]> {
  const principalPolicies = await Promise.all(
    path.flatMap((bundle) =>
      asVerifiedContainerManifest(bundle).state.referencedPrincipalHeads.map(
        (reference) =>
          loadVerifiedPrincipalPolicy(
            db,
            reference.principalType,
            reference.principalId,
          ),
      ),
    ),
  );
  const byKey = new Map<string, VerifiedPrincipalPolicy>();
  for (const policy of principalPolicies) {
    byKey.set(
      [
        policy.principalType,
        policy.principalId,
        policy.version,
        policy.stateHash,
      ].join(":"),
      policy,
    );
  }

  return [...byKey.values()];
}

async function createChildContainer(input: {
  readonly parent: StoredRootFixture;
  readonly signer: TestUser;
}): Promise<ContainerMutationResponse> {
  const containerId = crypto.randomUUID();
  const containerKeyEpochId = await createTestContainerKekId(containerId, 1);
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
  const principalPolicies = await loadPrincipalPoliciesForContainerPath([
    input.parent.bundle,
  ]);
  const request: ContainerMutationRequest = {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    parentContainerPath: [input.parent.bundle],
    principalPolicies: principalPolicies as unknown as Record<
      string,
      unknown
    >[],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    predecessorBridge: null,
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
    targetContainerPathRefs: [
      {
        containerId: input.root.kekState.containerId,
        manifestHash: input.root.bundle.manifestHash,
      },
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

async function buildDocumentLinkRequest(input: {
  readonly child: ContainerMutationResponse;
  readonly createdDocument: DocumentCreateResponse;
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
    targetContainerPathRefs: [
      {
        containerId: input.root.kekState.containerId,
        manifestHash: input.root.bundle.manifestHash,
      },
      {
        containerId: input.child.containerId,
        manifestHash: childBundle.manifestHash,
      },
    ],
    authorizingContainerPathRefs: [
      [
        {
          containerId: input.root.kekState.containerId,
          manifestHash: input.root.bundle.manifestHash,
        },
      ],
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

async function linkDocumentToSecondContainer(input: {
  readonly child: ContainerMutationResponse;
  readonly createdDocument: DocumentCreateResponse;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<void> {
  const request = await buildDocumentLinkRequest(input);
  const response = await routeApp.request(
    `/documents/${input.createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  expect(response.status).toBe(200);
  expect(isDocumentLinkSetMutationResponse(await response.json())).toBe(true);
}

async function purgeDocumentViaRoute(input: {
  readonly app?: Pick<typeof routeApp, "request">;
  readonly documentId: string;
  readonly token: string;
}): Promise<Response> {
  return (input.app ?? routeApp).request(`/documents/${input.documentId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${input.token}`,
    },
  });
}

// Writes `bytes` into the production runtime's object store at `storageKey`
// using the same multipart API the blob upload flow uses, so a purge that calls
// deleteObject(storageKey) can be observed against the store routeApp uses.
async function putBlobObjectBytes(
  storageKey: string,
  bytes: string,
): Promise<void> {
  const store = getDefaultApiServiceRuntime().blobObjectStore;
  await uploadBlobObject(store, storageKey, bytes);
}

interface SeededAttachment {
  readonly bindingId: string;
  readonly blobId: string;
  readonly storageKey: string;
}

// Inserts a committed object-store-backed blob plus an active attachment
// binding to `documentId`. The blob bytes live in the runtime object store at
// `storageKey`, mirroring a promoted multipart upload.
async function seedExternalBlobAttachment(input: {
  readonly documentId: string;
  readonly documentManifestHash: string;
  readonly slotId: string;
  readonly bytes?: string;
  readonly blobId?: string;
  readonly storageKey?: string;
}): Promise<SeededAttachment> {
  const blobId = input.blobId ?? crypto.randomUUID();
  const storageKey = input.storageKey ?? `blob-object:${crypto.randomUUID()}`;
  const bytes = input.bytes ?? `encrypted-blob-bytes:${blobId}`;
  const bindingId = crypto.randomUUID();

  // Only seed the bytes + blob row the first time we see this blob/key. When a
  // blob is shared, the second call reuses the existing blob row and bytes.
  if (input.blobId === undefined) {
    await putBlobObjectBytes(storageKey, bytes);
    await db.insert(blobs).values({
      id: blobId,
      storageKey,
      sha256: `sha256:${blobId}`,
      byteLength: Buffer.byteLength(bytes, "utf8"),
    });
  }

  await db.insert(attachmentBindings).values({
    id: bindingId,
    documentId: input.documentId,
    slotId: input.slotId,
    blobId,
    documentManifestHash: input.documentManifestHash,
  });

  return { bindingId, blobId, storageKey };
}

async function registerAndAuthenticate(user: TestUser): Promise<void> {
  await registerUser(user);
  await authenticate(user);
}

interface DocumentRowPresence {
  readonly accessEvents: number;
  readonly accessManifestDocumentLinkProjection: number;
  readonly accessManifestHeads: number;
  readonly accessManifests: number;
  readonly documentContainerLinks: number;
  readonly documentContentKeyEpochs: number;
  readonly documentContentKeyTargets: number;
  readonly documentContentWriteHeaders: number;
  readonly documentUpdates: number;
  readonly documents: number;
}

async function countDocumentRows(
  documentId: string,
): Promise<DocumentRowPresence> {
  const [
    documentRows,
    linkRows,
    manifestRows,
    manifestHeadRows,
    eventRows,
    epochRows,
    targetRows,
    writeHeaderRows,
    updateRows,
    linkProjectionRows,
  ] = await Promise.all([
    db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, documentId)),
    db
      .select({ id: documentContainerLinks.id })
      .from(documentContainerLinks)
      .where(eq(documentContainerLinks.documentId, documentId)),
    db
      .select({ manifestHash: accessManifests.manifestHash })
      .from(accessManifests)
      .where(
        and(
          eq(accessManifests.objectKind, "document"),
          eq(accessManifests.objectId, documentId),
        ),
      ),
    db
      .select({ manifestHash: accessManifestHeads.manifestHash })
      .from(accessManifestHeads)
      .where(
        and(
          eq(accessManifestHeads.objectKind, "document"),
          eq(accessManifestHeads.objectId, documentId),
        ),
      ),
    db
      .select({ eventHash: accessEvents.eventHash })
      .from(accessEvents)
      .where(
        and(
          eq(accessEvents.objectKind, "document"),
          eq(accessEvents.objectId, documentId),
        ),
      ),
    db
      .select({ id: documentContentKeyEpochs.id })
      .from(documentContentKeyEpochs)
      .where(eq(documentContentKeyEpochs.documentId, documentId)),
    db
      .select({ id: documentContentKeyTargets.id })
      .from(documentContentKeyTargets)
      .innerJoin(
        documentContentKeyEpochs,
        eq(
          documentContentKeyTargets.documentContentKeyEpochId,
          documentContentKeyEpochs.id,
        ),
      )
      .where(eq(documentContentKeyEpochs.documentId, documentId)),
    db
      .select({ updateId: documentContentWriteHeaders.updateId })
      .from(documentContentWriteHeaders)
      .where(eq(documentContentWriteHeaders.documentId, documentId)),
    db
      .select({ id: documentUpdates.id })
      .from(documentUpdates)
      .where(eq(documentUpdates.documentId, documentId)),
    db
      .select({ documentId: accessManifestDocumentLinkProjection.documentId })
      .from(accessManifestDocumentLinkProjection)
      .where(eq(accessManifestDocumentLinkProjection.documentId, documentId)),
  ]);

  return {
    accessEvents: eventRows.length,
    accessManifestDocumentLinkProjection: linkProjectionRows.length,
    accessManifestHeads: manifestHeadRows.length,
    accessManifests: manifestRows.length,
    documentContainerLinks: linkRows.length,
    documentContentKeyEpochs: epochRows.length,
    documentContentKeyTargets: targetRows.length,
    documentContentWriteHeaders: writeHeaderRows.length,
    documentUpdates: updateRows.length,
    documents: documentRows.length,
  };
}

async function countTombstones(input: {
  readonly containerId: string;
  readonly documentId: string;
}): Promise<number> {
  const rows = await db
    .select({ id: containerDocumentSyncTombstones.id })
    .from(containerDocumentSyncTombstones)
    .where(
      and(
        eq(containerDocumentSyncTombstones.containerId, input.containerId),
        eq(containerDocumentSyncTombstones.documentId, input.documentId),
      ),
    );

  return rows.length;
}

test("document purge succeeds when event publication fails", async () => {
  const owner = createTestUser();
  const publishedEvents: Array<Record<string, unknown>> = [];
  const app = createRouteApp({
    runtime: createFailingRuntime((event) => publishedEvents.push(event)),
  });
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const before = await countDocumentRows(created.id);
  expect(before.documents).toBe(1);
  expect(before.documentContainerLinks).toBe(1);
  expect(before.accessManifests).toBeGreaterThan(0);
  expect(before.accessEvents).toBeGreaterThan(0);
  expect(before.documentContentKeyEpochs).toBeGreaterThan(0);
  expect(before.documentContentKeyTargets).toBeGreaterThan(0);
  expect(before.accessManifestDocumentLinkProjection).toBeGreaterThan(0);

  const response = await purgeDocumentViaRoute({
    app,
    documentId: created.id,
    token: owner.token,
  });

  expect(response.status).toBe(200);
  const purged = await response.json();
  expect(isDocumentPurgeResponse(purged)).toBe(true);
  expect(purged.documentId).toBe(created.id);
  expect(typeof purged.purgedAt).toBe("string");
  expect(new Date(purged.purgedAt).toISOString()).toBe(purged.purgedAt);
  expect(purged.reclaimedBlobStorageKeys).toEqual([]);
  expect(publishedEvents).toHaveLength(1);

  const after = await countDocumentRows(created.id);
  expect(after).toEqual({
    accessEvents: 0,
    accessManifestDocumentLinkProjection: 0,
    accessManifestHeads: 0,
    accessManifests: 0,
    documentContainerLinks: 0,
    documentContentKeyEpochs: 0,
    documentContentKeyTargets: 0,
    documentContentWriteHeaders: 0,
    documentUpdates: 0,
    documents: 0,
  });

  expect(
    await countTombstones({
      containerId: root.kekState.containerId,
      documentId: created.id,
    }),
  ).toBe(1);
});

test("DELETE /documents/:documentId rejects a document linked to more than one container", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const created = await createDocument({ owner, root });
  await linkDocumentToSecondContainer({
    child,
    createdDocument: created,
    owner,
    root,
  });

  const before = await countDocumentRows(created.id);
  expect(before.documents).toBe(1);
  expect(before.documentContainerLinks).toBe(2);

  const response = await purgeDocumentViaRoute({
    documentId: created.id,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error:
      "Document must be linked to a single container before it can be purged",
  });

  // Nothing was deleted: the full per-document footprint is unchanged.
  const after = await countDocumentRows(created.id);
  expect(after).toEqual(before);
  expect(
    await countTombstones({
      containerId: root.kekState.containerId,
      documentId: created.id,
    }),
  ).toBe(0);
});

test("DELETE /documents/:documentId rejects callers without write access to the container", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerAndAuthenticate(owner);
  await registerAndAuthenticate(outsider);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const response = await purgeDocumentViaRoute({
    documentId: created.id,
    token: outsider.token,
  });

  expect([403, 404]).toContain(response.status);

  const after = await countDocumentRows(created.id);
  expect(after.documents).toBe(1);
  expect(after.documentContainerLinks).toBe(1);
  expect(after.accessManifests).toBeGreaterThan(0);
  expect(after.documentContentKeyEpochs).toBeGreaterThan(0);
  expect(
    await countTombstones({
      containerId: root.kekState.containerId,
      documentId: created.id,
    }),
  ).toBe(0);
});

test("DELETE /documents/:documentId returns 404 for an unknown document id", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);

  const response = await purgeDocumentViaRoute({
    documentId: crypto.randomUUID(),
    token: owner.token,
  });

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Document not found" });
});

test("DELETE /documents/:documentId soft-deletes an orphaned blob and retains its bytes", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const attachment = await seedExternalBlobAttachment({
    documentId: created.id,
    documentManifestHash: created.accessManifest.manifestHash,
    slotId: "slot_purge_image",
  });

  expect(
    await readBlobObjectText(
      getDefaultApiServiceRuntime().blobObjectStore,
      attachment.storageKey,
    ),
  ).not.toBeNull();

  const response = await purgeDocumentViaRoute({
    documentId: created.id,
    token: owner.token,
  });

  expect(response.status).toBe(200);
  const purged = await response.json();
  expect(isDocumentPurgeResponse(purged)).toBe(true);
  // Bytes are retained for a later GC sweep, not reclaimed synchronously: a
  // concurrent bind to a shared blob is a phantom this purge cannot see, so the
  // irreversible byte deletion is deferred until reachability is re-checked.
  expect(purged.reclaimedBlobStorageKeys).toEqual([]);

  // The blob row survives, soft-deleted with dereferencedAt stamped.
  const blobRows = await db
    .select({ id: blobs.id, dereferencedAt: blobs.dereferencedAt })
    .from(blobs)
    .where(eq(blobs.id, attachment.blobId));
  expect(blobRows).toHaveLength(1);
  expect(blobRows[0]?.dereferencedAt).not.toBeNull();

  // The purged document's own binding is gone.
  const bindingRows = await db
    .select({ id: attachmentBindings.id })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.blobId, attachment.blobId));
  expect(bindingRows).toHaveLength(0);

  // The encrypted bytes are still present in the object store.
  expect(
    await readBlobObjectText(
      getDefaultApiServiceRuntime().blobObjectStore,
      attachment.storageKey,
    ),
  ).not.toBeNull();
});

test("DELETE /documents/:documentId preserves a blob shared with another document", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const documentToPurge = await createDocument({ owner, root });
  const survivingDocument = await createDocument({ owner, root });

  // Bind the same blob (and the same object-store bytes) to both documents.
  const shared = await seedExternalBlobAttachment({
    documentId: documentToPurge.id,
    documentManifestHash: documentToPurge.accessManifest.manifestHash,
    slotId: "slot_shared_image",
  });
  await seedExternalBlobAttachment({
    documentId: survivingDocument.id,
    documentManifestHash: survivingDocument.accessManifest.manifestHash,
    slotId: "slot_shared_image",
    blobId: shared.blobId,
    storageKey: shared.storageKey,
  });

  const response = await purgeDocumentViaRoute({
    documentId: documentToPurge.id,
    token: owner.token,
  });

  expect(response.status).toBe(200);
  const purged = await response.json();
  expect(isDocumentPurgeResponse(purged)).toBe(true);
  // The blob still has an active binding on the surviving document, so its
  // bytes must not be reclaimed.
  expect(purged.reclaimedBlobStorageKeys).toEqual([]);

  // The purged document's own binding is gone, but the blob row survives.
  const purgedDocumentBindings = await db
    .select({ id: attachmentBindings.id })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.documentId, documentToPurge.id));
  expect(purgedDocumentBindings).toHaveLength(0);

  const survivingBindings = await db
    .select({ id: attachmentBindings.id })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.documentId, survivingDocument.id));
  expect(survivingBindings).toHaveLength(1);

  const blobRows = await db
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, shared.blobId));
  expect(blobRows).toHaveLength(1);

  expect(
    await readBlobObjectText(
      getDefaultApiServiceRuntime().blobObjectStore,
      shared.storageKey,
    ),
  ).not.toBeNull();
});

// Mark an existing binding detached, simulating a replace/detach that retains
// the binding row as history.
async function markBindingDetached(bindingId: string): Promise<void> {
  await db
    .update(attachmentBindings)
    .set({ detachedAt: new Date("2026-06-01T00:00:00.000Z") })
    .where(eq(attachmentBindings.id, bindingId));
}

// Seed the per-blob audit-object row plus an attachment audit event on a
// document that references the blob, simulating retained attachment history.
async function seedBlobAuditHistory(input: {
  readonly actor: TestUser;
  readonly blobId: string;
  readonly documentId: string;
  readonly accessManifestHash: string;
  readonly slotId: string;
}): Promise<void> {
  await db
    .insert(blobAuditObjects)
    .values({
      blobId: input.blobId,
      sha256: `sha256:${input.blobId}`,
      byteLength: 16,
      liveStorageKey: null,
      retentionMode: "live_only",
      historicalBytesRetained: false,
    })
    .onConflictDoNothing();

  const [entry] = await db
    .insert(documentAuditEntries)
    .values({
      documentId: input.documentId,
      eventType: "attachment_event",
      accessEpoch: 1,
      accessManifestHash: input.accessManifestHash,
      actorUserId: input.actor.userId,
      actorFingerprint: input.actor.fingerprint,
      entryHash: `entry:${crypto.randomUUID()}`,
    })
    .returning({ id: documentAuditEntries.id });
  invariant(entry, "expected seeded audit entry");

  await db.insert(documentAttachmentAuditEvents).values({
    auditEntryId: entry.id,
    action: "detach",
    slotId: input.slotId,
    blobId: input.blobId,
    retentionMode: "live_only",
  });
}

// Regression for the purge over-reclaim defect (issue #1041 / scrub finding #4):
// a blob that another document still references only through a DETACHED binding
// (plus retained attachment audit history) must NOT be reclaimed when purging an
// unrelated document. The old orphan check looked only at ACTIVE bindings on
// other documents, so it would destroy bytes + the immutable blobAuditObjects
// row still referenced by the other document's history.
test("DELETE /documents/:documentId preserves a blob another document references via a detached binding", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const documentToPurge = await createDocument({ owner, root });
  const survivingDocument = await createDocument({ owner, root });

  // The blob is actively bound on the document we purge...
  const shared = await seedExternalBlobAttachment({
    documentId: documentToPurge.id,
    documentManifestHash: documentToPurge.accessManifest.manifestHash,
    slotId: "slot_shared_image",
  });
  // ...and only DETACHED (history) on the surviving document, which also has a
  // retained attachment audit event + blob-audit-object row referencing it.
  const survivingBinding = await seedExternalBlobAttachment({
    documentId: survivingDocument.id,
    documentManifestHash: survivingDocument.accessManifest.manifestHash,
    slotId: "slot_shared_image",
    blobId: shared.blobId,
    storageKey: shared.storageKey,
  });
  await markBindingDetached(survivingBinding.bindingId);
  await seedBlobAuditHistory({
    accessManifestHash: survivingDocument.accessManifest.manifestHash,
    actor: owner,
    blobId: shared.blobId,
    documentId: survivingDocument.id,
    slotId: "slot_shared_image",
  });

  const response = await purgeDocumentViaRoute({
    documentId: documentToPurge.id,
    token: owner.token,
  });

  expect(response.status).toBe(200);
  const purged = await response.json();
  expect(isDocumentPurgeResponse(purged)).toBe(true);
  // The surviving document still references the blob (detached binding + audit
  // history), so its bytes/row/audit-object must be preserved.
  expect(purged.reclaimedBlobStorageKeys).toEqual([]);

  const blobRows = await db
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, shared.blobId));
  expect(blobRows).toHaveLength(1);

  const auditObjectRows = await db
    .select({ blobId: blobAuditObjects.blobId })
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, shared.blobId));
  expect(auditObjectRows).toHaveLength(1);

  expect(
    await readBlobObjectText(
      getDefaultApiServiceRuntime().blobObjectStore,
      shared.storageKey,
    ),
  ).not.toBeNull();
});

// Regression for the replace-then-purge leak (issue #1041 / scrub finding #8):
// a blob whose only remaining references are this document's own DETACHED
// bindings (e.g. left behind by a replace) must be reclaimed on purge. The old
// candidate set considered only ACTIVE bindings, so such blobs leaked forever.
test("DELETE /documents/:documentId soft-deletes a blob referenced only by this document's detached binding", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  // Original blob, later "replaced": its binding is detached but retained.
  const replaced = await seedExternalBlobAttachment({
    documentId: created.id,
    documentManifestHash: created.accessManifest.manifestHash,
    slotId: "slot_replaced_image",
  });
  await markBindingDetached(replaced.bindingId);
  // The current blob occupying the slot after the replace.
  const current = await seedExternalBlobAttachment({
    documentId: created.id,
    documentManifestHash: created.accessManifest.manifestHash,
    slotId: "slot_replaced_image",
  });

  const response = await purgeDocumentViaRoute({
    documentId: created.id,
    token: owner.token,
  });

  expect(response.status).toBe(200);
  const purged = await response.json();
  expect(isDocumentPurgeResponse(purged)).toBe(true);
  // Both the replaced (detached) and current blobs were referenced only by this
  // document, so both are orphaned — soft-deleted with bytes retained, nothing
  // reclaimed synchronously.
  expect(purged.reclaimedBlobStorageKeys).toEqual([]);

  for (const blobId of [replaced.blobId, current.blobId]) {
    const blobRows = await db
      .select({ id: blobs.id, dereferencedAt: blobs.dereferencedAt })
      .from(blobs)
      .where(eq(blobs.id, blobId));
    expect(blobRows).toHaveLength(1);
    expect(blobRows[0]?.dereferencedAt).not.toBeNull();
  }
  for (const storageKey of [replaced.storageKey, current.storageKey]) {
    expect(
      await readBlobObjectText(
        getDefaultApiServiceRuntime().blobObjectStore,
        storageKey,
      ),
    ).not.toBeNull();
  }
});
