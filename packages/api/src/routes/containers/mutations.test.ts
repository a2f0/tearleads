import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type {
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  KekRecipientKind,
  KeyingCanonicalJson,
  PrincipalProjectionMember,
  PrincipalStateMember,
  ReferencedPrincipalHead,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computePrincipalStateHash,
  deriveContainerAccessManifest,
  derivePrincipalRecipientKeyEpochId,
  generateKemSeedAndKeyPair,
  signAccessEvent,
  toFingerprint,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  ContainerManifestBundle,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import {
  type ContainerMutationResponse,
  isContainerMutationResponse,
  isPrincipalStateResponse,
} from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
} from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import { getAccessManifestBundle } from "../../access/accessManifestStore";
import {
  getCurrentContainerKeyEpoch,
  listContainerKeyWraps,
} from "../../access/containerKekStore";
import { db } from "../../adapters/postgres";
import { routeApp } from "../../routeApp";
import {
  attachmentBindings,
  blobContentKeyEpochs,
  blobContentKeyTargets,
  blobs,
  containerMetadataDocuments,
  containers,
  documentContainerLinks,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documents,
  users,
} from "../../schema";

interface RootContainerFixture {
  readonly id: string;
  readonly organizationId: string;
}

interface StoredContainerFixture {
  readonly bundle: ContainerManifestBundle;
  readonly kekState: VerifiedContainerKekState;
  readonly userKey?: ContainerUserRecipientKey;
}

interface DownstreamContentKeyRowCounts {
  readonly blobContentKeyEpochs: number;
  readonly blobContentKeyTargets: number;
  readonly documentContentKeyEpochs: number;
  readonly documentContentKeyTargets: number;
}

interface SeededDownstreamContentKeyRows {
  readonly blobId: string;
  readonly documentId: string;
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

  invariant(user, "expected user row");

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

  invariant(rootContainer, "expected root container row");
  return rootContainer;
}

async function registerAndAuthenticate(user: TestUser): Promise<void> {
  await registerUser(user);
  await authenticate(user);
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

function asVerifiedContainerManifest(
  bundle: ContainerManifestBundle,
): VerifiedContainerAccessManifest {
  return bundle as unknown as VerifiedContainerAccessManifest;
}

function accessManifestFromResponse(
  response: ContainerMutationResponse,
): ContainerManifestBundle {
  return response.accessManifest as unknown as ContainerManifestBundle;
}

function kekStateFromResponse(
  response: ContainerMutationResponse,
): VerifiedContainerKekState {
  return response.containerKek as unknown as VerifiedContainerKekState;
}

async function createSignedContainerEvent(input: {
  readonly body: ContainerAccessEventBody;
  readonly dependencyManifestHashes?: readonly string[];
  readonly objectId: string;
  readonly organizationId: string;
  readonly previousManifestHash: string | null;
  readonly signer: TestUser;
}): Promise<VerifiedAccessEvent> {
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: "container",
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
      signedAt: "2026-04-26T12:00:00.000Z",
    },
    input.signer.signing.signingPrivateKey,
  );
  const verifiedEvent = await verifySignedAccessEvent({
    body: input.body as unknown as KeyingCanonicalJson,
    event,
    signerPublicKey: input.signer.signing.signingPublicKey,
  });

  expect(verifiedEvent.ok).toBe(true);
  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

async function createManifestBundle(
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
  readonly parentKekState: VerifiedContainerKekState | null;
}): ContainerKeyEpoch {
  const verifiedManifest = asVerifiedContainerManifest(input.manifest);

  return {
    id: input.containerKeyEpochId,
    containerId: verifiedManifest.state.containerId,
    keyEpoch: input.keyEpoch,
    accessManifestHash: verifiedManifest.manifestHash,
    parentContainerKeyEpochId:
      input.parentKekState?.containerKeyEpochId ?? null,
    createdByEventHash: verifiedManifest.event.eventHash,
    createdByManifestHash: verifiedManifest.manifestHash,
  };
}

function createContainerKeyWrap(input: {
  readonly containerKeyEpochId: string;
  readonly recipientId: string;
  readonly recipientKeyEpochId: string;
  readonly recipientKeyFingerprint: string;
  readonly recipientKind: KekRecipientKind;
  readonly wrapManifestHash: string;
}): ContainerKeyWrap {
  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: input.recipientKind,
    recipientId: input.recipientId,
    recipientKeyEpochId: input.recipientKeyEpochId,
    recipientKeyFingerprint: input.recipientKeyFingerprint,
    kemCipherText: `kem:${input.containerKeyEpochId}:${input.recipientId}`,
    wrappedKey: `wrapped:${input.containerKeyEpochId}:${input.recipientId}`,
    wrapManifestHash: input.wrapManifestHash,
  };
}

async function verifyKekState(input: {
  readonly bundle: ContainerManifestBundle;
  readonly containerManifestHistory?: readonly ContainerManifestBundle[];
  readonly keyEpoch: ContainerKeyEpoch;
  readonly parentKekState?: VerifiedContainerKekState | null;
  readonly userRecipientKeys?: readonly ContainerUserRecipientKey[];
  readonly wraps: readonly ContainerKeyWrap[];
}): Promise<VerifiedContainerKekState> {
  const containerManifestHistory = input.containerManifestHistory?.map(
    asVerifiedContainerManifest,
  );
  const verified = await verifyContainerKekState({
    containerManifest: asVerifiedContainerManifest(input.bundle),
    keyEpoch: input.keyEpoch,
    parentKekState: input.parentKekState ?? null,
    userRecipientKeys: input.userRecipientKeys ?? [],
    wraps: input.wraps,
    ...(containerManifestHistory !== undefined
      ? { containerManifestHistory }
      : {}),
  });

  expect(verified.ok).toBe(true);
  if (!verified.ok) {
    throw verified.error;
  }

  return verified.value;
}

async function putGroupPrincipalPolicy(input: {
  readonly actor: TestUser;
  readonly keyEpoch?: number;
  readonly members?: readonly PrincipalStateMember[];
  readonly prevStateHash?: string | null;
  readonly principalId: string;
  readonly principalKem?: ReturnType<typeof generateKemSeedAndKeyPair>;
  readonly projection?: readonly PrincipalProjectionMember[];
  readonly signedAt?: string;
  readonly version?: number;
}): Promise<{
  readonly policy: VerifiedPrincipalPolicy;
  readonly reference: ReferencedPrincipalHead;
  readonly stateHash: string;
}> {
  const principalKem = input.principalKem ?? generateKemSeedAndKeyPair();
  const members = [
    ...(input.members ?? [
      { principalType: "user" as const, principalId: input.actor.userId },
    ]),
  ];
  const projection = [
    ...(input.projection ??
      createProjectionWithAdminSigner(input.actor.userId, members)),
  ];
  const signedState = await signPrincipalStateBundle({
    principalType: "group",
    principalId: input.principalId,
    version: input.version ?? 1,
    prevStateHash: input.prevStateHash ?? null,
    keyEpoch: input.keyEpoch ?? 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members,
    projection,
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(JSON.stringify({ members: projection })),
    ),
    signedAt:
      input.signedAt ?? new Date("2026-04-30T00:00:00.000Z").toISOString(),
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
  });
  const response = await routeApp.request(
    `/principals/group/${input.principalId}/state`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.actor.token}`,
      },
      body: JSON.stringify({
        state: signedState.state,
        encryptedPayload: signedState.encryptedPayload,
        projection: signedState.projection,
      }),
    },
  );

  expect(response.status).toBe(200);
  const storedState = await response.json();
  invariant(
    isPrincipalStateResponse(storedState),
    "expected principal state response",
  );

  const stateHash = await computePrincipalStateHash(signedState.state);
  expect(storedState.stateHash).toBe(stateHash);

  const policyState = {
    ...signedState.state,
    stateHash,
  };
  const reference: ReferencedPrincipalHead = {
    principalType: "group",
    principalId: input.principalId,
    version: policyState.version,
    keyEpoch: policyState.keyEpoch,
    stateHash,
    keyFingerprint: policyState.keyFingerprint,
  };
  const policy = {
    principalType: "group",
    principalId: input.principalId,
    version: policyState.version,
    keyEpoch: policyState.keyEpoch,
    stateHash,
    state: policyState,
    projection: signedState.projection,
    checkpoint: {
      principalType: "group",
      principalId: input.principalId,
      version: policyState.version,
      stateHash,
    },
  } as VerifiedPrincipalPolicy;

  return {
    policy,
    reference,
    stateHash,
  };
}

function toStoredContainerKeyEpoch(
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

function toStoredContainerKeyWrap(
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
  const storedKeyEpoch = await getCurrentContainerKeyEpoch(rootContainer.id);
  const keyEpoch = toStoredContainerKeyEpoch(storedKeyEpoch);
  const bundle = await getAccessManifestBundle(keyEpoch.accessManifestHash);
  invariant(bundle, "expected registered root container manifest");
  const wraps = (await listContainerKeyWraps(keyEpoch.id)).map(
    toStoredContainerKeyWrap,
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

  return {
    bundle: bundle as unknown as ContainerManifestBundle,
    kekState,
    userKey: ownerKey,
  };
}

async function buildCreateRequest(input: {
  readonly containerId: string;
  readonly dependencyManifestHashesOverride?: readonly string[];
  readonly parent: ContainerManifestBundle;
  readonly parentKekState: VerifiedContainerKekState;
  readonly parentManifestHashOverride?: string;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const parent = asVerifiedContainerManifest(input.parent);
  const containerKeyEpochId = crypto.randomUUID();
  const parentManifestHash =
    input.parentManifestHashOverride ?? input.parent.manifestHash;
  const metadataDocumentId = crypto.randomUUID();
  const body: ContainerAccessEventBody = {
    eventType: "container.create",
    parentContainerId: parent.state.containerId,
    parentManifestHash,
    metadataDocumentId,
    containerKeyEpochId,
    directGrants: [],
    referencedPrincipalHeads: [],
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: input.dependencyManifestHashesOverride ?? [
      input.parent.manifestHash,
    ],
    objectId: input.containerId,
    organizationId: parent.state.organizationId,
    previousManifestHash: null,
    signer: input.signer,
  });
  const bundle = await createManifestBundle(
    {
      version: 1,
      containerId: input.containerId,
      organizationId: parent.state.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash: event.eventHash,
      parentContainerId: parent.state.containerId,
      parentManifestHash,
      metadataDocumentId,
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
    parentKekState: input.parentKekState,
  });
  const wraps = [
    createContainerKeyWrap({
      containerKeyEpochId,
      recipientKind: "container",
      recipientId: input.parentKekState.containerId,
      recipientKeyEpochId: input.parentKekState.containerKeyEpochId,
      recipientKeyFingerprint: input.parentKekState.keyEpochHash,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    parentContainerPath: [input.parent],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<string, unknown>,
    userRecipientKeys: [],
  };
}

async function buildGrantRequest(input: {
  readonly parentKekState: VerifiedContainerKekState;
  readonly previous: ContainerManifestBundle;
  readonly previousContainerPath: readonly ContainerManifestBundle[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly recipient: TestUser;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const recipientKey = await userRecipientKey(input.recipient);
  const grant = {
    subjectType: "user" as const,
    subjectId: input.recipient.userId,
    accessLevel: "read" as const,
  };
  const body: ContainerAccessEventBody = {
    eventType: "container.grant",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    grant,
    referencedPrincipalHead: null,
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        input.previousContainerPath.map((manifest) => manifest.manifestHash),
      ),
    ],
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createManifestBundle(
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
    createContainerKeyWrap({
      containerKeyEpochId: input.previousKekState.containerKeyEpochId,
      recipientKind: "user",
      recipientId: recipientKey.userId,
      recipientKeyEpochId: recipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: recipientKey.recipientKeyFingerprint,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [...input.previousContainerPath],
    containerManifestHistory: [input.previous],
    keyEpoch: input.previousKekState.keyEpoch as unknown as Record<
      string,
      unknown
    >,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<string, unknown>,
    userRecipientKeys: [recipientKey as unknown as Record<string, unknown>],
  };
}

async function buildGroupGrantRequest(input: {
  readonly containerManifestHistory?: readonly ContainerManifestBundle[];
  readonly parentKekState: VerifiedContainerKekState;
  readonly previous: ContainerManifestBundle;
  readonly previousContainerPath: readonly ContainerManifestBundle[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly principalPolicy: VerifiedPrincipalPolicy;
  readonly principalReference: ReferencedPrincipalHead;
  readonly signer: TestUser;
  readonly userRecipientKeys?: readonly ContainerUserRecipientKey[];
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const principalPolicies = [
    ...(input.principalPolicies ?? []),
    input.principalPolicy,
  ].filter(
    (policy, index, policies) =>
      policies.findIndex(
        (candidate) =>
          candidate.principalType === policy.principalType &&
          candidate.principalId === policy.principalId &&
          candidate.stateHash === policy.stateHash,
      ) === index,
  );
  const grant = {
    subjectType: "group" as const,
    subjectId: input.principalReference.principalId,
    accessLevel: "read" as const,
  };
  const body: ContainerAccessEventBody = {
    eventType: "container.grant",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    grant,
    referencedPrincipalHead: input.principalReference,
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        input.previousContainerPath.map((manifest) => manifest.manifestHash),
      ),
    ],
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.previous.manifestHash,
      eventHash: event.eventHash,
      directGrants: [...previous.state.directGrants, grant],
      referencedPrincipalHeads: [
        ...previous.state.referencedPrincipalHeads,
        input.principalReference,
      ],
    },
    event,
  );
  const wraps = [
    ...(input.previousKekState.wraps as readonly ContainerKeyWrap[]),
    createContainerKeyWrap({
      containerKeyEpochId: input.previousKekState.containerKeyEpochId,
      recipientKind: "group",
      recipientId: input.principalReference.principalId,
      recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
        input.principalReference,
      ),
      recipientKeyFingerprint: input.principalReference.keyFingerprint,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [...input.previousContainerPath],
    containerManifestHistory: [
      ...(input.containerManifestHistory ?? [input.previous]),
    ],
    principalPolicies: principalPolicies as unknown as Record<
      string,
      unknown
    >[],
    keyEpoch: input.previousKekState.keyEpoch as unknown as Record<
      string,
      unknown
    >,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<string, unknown>,
    userRecipientKeys: (input.userRecipientKeys ?? []) as unknown as Record<
      string,
      unknown
    >[],
  };
}

async function buildRevokeRequest(input: {
  readonly parentKekState: VerifiedContainerKekState;
  readonly previous: ContainerManifestBundle;
  readonly previousContainerPath: readonly ContainerManifestBundle[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly revokedUser: TestUser;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const containerKeyEpochId = crypto.randomUUID();
  const body: ContainerAccessEventBody = {
    eventType: "container.revoke",
    containerKeyEpochId,
    subjectType: "user",
    subjectId: input.revokedUser.userId,
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        input.previousContainerPath.map((manifest) => manifest.manifestHash),
      ),
    ],
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createManifestBundle(
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
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: input.previousKekState.containerKeyEpoch + 1,
    manifest: bundle,
    parentKekState: input.parentKekState,
  });
  const wraps = [
    createContainerKeyWrap({
      containerKeyEpochId,
      recipientKind: "container",
      recipientId: input.parentKekState.containerId,
      recipientKeyEpochId: input.parentKekState.containerKeyEpochId,
      recipientKeyFingerprint: input.parentKekState.keyEpochHash,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [...input.previousContainerPath],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<string, unknown>,
    userRecipientKeys: [],
  };
}

async function buildRekeyRequest(input: {
  readonly parentKekState: VerifiedContainerKekState;
  readonly previous: ContainerManifestBundle;
  readonly previousContainerPath: readonly ContainerManifestBundle[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const containerKeyEpochId = crypto.randomUUID();
  const body: ContainerAccessEventBody = {
    eventType: "container.rekey",
    containerKeyEpochId,
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        input.previousContainerPath.map((manifest) => manifest.manifestHash),
      ),
    ],
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.previous.manifestHash,
      eventHash: event.eventHash,
      containerKeyEpochId,
    },
    event,
  );
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: input.previousKekState.containerKeyEpoch + 1,
    manifest: bundle,
    parentKekState: input.parentKekState,
  });
  const wraps = [
    createContainerKeyWrap({
      containerKeyEpochId,
      recipientKind: "container",
      recipientId: input.parentKekState.containerId,
      recipientKeyEpochId: input.parentKekState.containerKeyEpochId,
      recipientKeyFingerprint: input.parentKekState.keyEpochHash,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [...input.previousContainerPath],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<string, unknown>,
    userRecipientKeys: [],
  };
}

async function buildMoveRequest(input: {
  readonly destinationParent: ContainerManifestBundle;
  readonly destinationParentKekState: VerifiedContainerKekState;
  readonly destinationParentPath: readonly ContainerManifestBundle[];
  readonly previous: ContainerManifestBundle;
  readonly previousContainerPath: readonly ContainerManifestBundle[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const destinationParent = asVerifiedContainerManifest(
    input.destinationParent,
  );
  const containerKeyEpochId = crypto.randomUUID();
  const body: ContainerAccessEventBody = {
    eventType: "container.move",
    parentContainerId: destinationParent.state.containerId,
    parentManifestHash: input.destinationParent.manifestHash,
    containerKeyEpochId,
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        [...input.previousContainerPath, ...input.destinationParentPath].map(
          (manifest) => manifest.manifestHash,
        ),
      ),
    ],
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.previous.manifestHash,
      eventHash: event.eventHash,
      parentContainerId: destinationParent.state.containerId,
      parentManifestHash: input.destinationParent.manifestHash,
      containerKeyEpochId,
    },
    event,
  );
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: input.previousKekState.containerKeyEpoch + 1,
    manifest: bundle,
    parentKekState: input.destinationParentKekState,
  });
  const wraps = [
    createContainerKeyWrap({
      containerKeyEpochId,
      recipientKind: "container",
      recipientId: input.destinationParentKekState.containerId,
      recipientKeyEpochId: input.destinationParentKekState.containerKeyEpochId,
      recipientKeyFingerprint: input.destinationParentKekState.keyEpochHash,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [...input.previousContainerPath],
    destinationParentContainerPath: [...input.destinationParentPath],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.destinationParentKekState as unknown as Record<
      string,
      unknown
    >,
    userRecipientKeys: [],
  };
}

async function postMutation(input: {
  readonly path: string;
  readonly request: ContainerMutationRequest;
  readonly token: string;
}): Promise<Response> {
  return routeApp.request(input.path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify(input.request),
  });
}

async function expectMutationSuccess(
  response: Response,
): Promise<ContainerMutationResponse> {
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(isContainerMutationResponse(body)).toBe(true);
  return body as ContainerMutationResponse;
}

async function createChild(input: {
  readonly containerId?: string;
  readonly parent: ContainerManifestBundle;
  readonly parentKekState: VerifiedContainerKekState;
  readonly signer: TestUser;
}): Promise<ContainerMutationResponse> {
  const request = await buildCreateRequest({
    containerId: input.containerId ?? crypto.randomUUID(),
    parent: input.parent,
    parentKekState: input.parentKekState,
    signer: input.signer,
  });

  return expectMutationSuccess(
    await postMutation({
      path: "/containers",
      request,
      token: input.signer.token,
    }),
  );
}

async function countDownstreamContentKeyRows(
  seeded: SeededDownstreamContentKeyRows,
): Promise<DownstreamContentKeyRowCounts> {
  const [
    blobContentKeyEpochRows,
    blobContentKeyTargetRows,
    documentContentKeyEpochRows,
    documentContentKeyTargetRows,
  ] = await Promise.all([
    db
      .select({ id: blobContentKeyEpochs.id })
      .from(blobContentKeyEpochs)
      .where(eq(blobContentKeyEpochs.blobId, seeded.blobId)),
    db
      .select({ id: blobContentKeyTargets.id })
      .from(blobContentKeyTargets)
      .innerJoin(
        blobContentKeyEpochs,
        eq(
          blobContentKeyTargets.blobContentKeyEpochId,
          blobContentKeyEpochs.id,
        ),
      )
      .where(eq(blobContentKeyEpochs.blobId, seeded.blobId)),
    db
      .select({ id: documentContentKeyEpochs.id })
      .from(documentContentKeyEpochs)
      .where(eq(documentContentKeyEpochs.documentId, seeded.documentId)),
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
      .where(eq(documentContentKeyEpochs.documentId, seeded.documentId)),
  ]);

  return {
    blobContentKeyEpochs: blobContentKeyEpochRows.length,
    blobContentKeyTargets: blobContentKeyTargetRows.length,
    documentContentKeyEpochs: documentContentKeyEpochRows.length,
    documentContentKeyTargets: documentContentKeyTargetRows.length,
  };
}

async function seedDownstreamContentKeyRows(input: {
  readonly containerId: string;
  readonly containerKeyEpoch: number;
  readonly containerKeyEpochId: string;
  readonly containerManifestHash: string;
  readonly owner: TestUser;
}): Promise<SeededDownstreamContentKeyRows> {
  const documentId = crypto.randomUUID();
  const documentLinkSetManifestHash = `document-link-set:${documentId}`;
  await db.insert(documents).values({
    id: documentId,
    createdByFingerprint: input.owner.fingerprint,
  });
  await db.insert(documentContainerLinks).values({
    documentId,
    containerId: input.containerId,
  });

  const [documentContentKeyEpoch] = await db
    .insert(documentContentKeyEpochs)
    .values({
      documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: documentLinkSetManifestHash,
      targetHash: `document-targets:${documentId}`,
    })
    .returning({ id: documentContentKeyEpochs.id });
  invariant(
    documentContentKeyEpoch,
    "expected seeded document content key epoch",
  );
  await db.insert(documentContentKeyTargets).values({
    documentContentKeyEpochId: documentContentKeyEpoch.id,
    containerId: input.containerId,
    containerManifestHash: input.containerManifestHash,
    containerKeyEpochId: input.containerKeyEpochId,
    containerKeyEpoch: input.containerKeyEpoch,
    wrappedKey: `wrapped-document-key:${documentId}`,
    wrappingMetadata: { alg: "test-wrap" },
  });

  const blobId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  await db.insert(blobs).values({
    id: blobId,
    storageKey: `blob:${blobId}`,
    encryptedBytes: "encrypted-blob-bytes",
    sha256: `sha256:${blobId}`,
    byteLength: 20,
  });
  await db.insert(attachmentBindings).values({
    id: bindingId,
    documentId,
    slotId: "seeded-slot",
    blobId,
    documentManifestHash: documentLinkSetManifestHash,
  });

  const [blobContentKeyEpoch] = await db
    .insert(blobContentKeyEpochs)
    .values({
      blobId,
      contentKeyEpoch: 1,
      targetHash: `blob-targets:${blobId}`,
    })
    .returning({ id: blobContentKeyEpochs.id });
  invariant(blobContentKeyEpoch, "expected seeded blob content key epoch");
  await db.insert(blobContentKeyTargets).values({
    blobContentKeyEpochId: blobContentKeyEpoch.id,
    bindingId,
    documentId,
    containerId: input.containerId,
    containerManifestHash: input.containerManifestHash,
    containerKeyEpochId: input.containerKeyEpochId,
    containerKeyEpoch: input.containerKeyEpoch,
    wrappedKey: `wrapped-blob-key:${blobId}`,
    wrappingMetadata: { alg: "test-wrap" },
  });

  return {
    blobId,
    documentId,
  };
}

test("POST /containers materializes the signed metadata document binding", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildCreateRequest({
    containerId: crypto.randomUUID(),
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  const created = await expectMutationSuccess(
    await postMutation({
      path: "/containers",
      request,
      token: owner.token,
    }),
  );
  const createdManifest = accessManifestFromResponse(created);
  const metadataDocumentId =
    asVerifiedContainerManifest(createdManifest).state.metadataDocumentId;
  const [binding] = await db
    .select({
      containerId: containerMetadataDocuments.containerId,
      documentId: containerMetadataDocuments.documentId,
    })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.containerId, created.containerId))
    .limit(1);

  expect(binding).toEqual({
    containerId: created.containerId,
    documentId: metadataDocumentId,
  });
});

test("POST /containers rejects metadata document id reuse", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildCreateRequest({
    containerId: crypto.randomUUID(),
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const metadataDocumentId = (
    request.body as { readonly metadataDocumentId: string }
  ).metadataDocumentId;
  await db.insert(documents).values({
    id: metadataDocumentId,
    createdByFingerprint: owner.fingerprint,
  });

  const response = await postMutation({
    path: "/containers",
    request,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Container metadata document already exists",
  });
});

test("POST /containers rejects child creates under stale parent manifests", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildCreateRequest({
    containerId: crypto.randomUUID(),
    parent: root.bundle,
    parentKekState: root.kekState,
    parentManifestHashOverride: "0".repeat(64),
    signer: owner,
  });

  const response = await postMutation({
    path: "/containers",
    request,
    token: owner.token,
  });

  expect(response.status).toBe(409);
});

test("POST /containers rejects signed events with missing dependency manifests", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildCreateRequest({
    containerId: crypto.randomUUID(),
    dependencyManifestHashesOverride: [],
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  const response = await postMutation({
    path: "/containers",
    request,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Access event dependency hashes do not match supplied manifests",
  });
});

test("POST /containers rejects malformed KEK request records", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildCreateRequest({
    containerId: crypto.randomUUID(),
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  request.keyEpoch = {
    ...request.keyEpoch,
    keyEpoch: "1",
  };

  const response = await postMutation({
    path: "/containers",
    request,
    token: owner.token,
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "keyEpoch.keyEpoch is invalid",
  });
});

test("POST /containers/:containerId/share rejects grants signed without admin access", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const intruder = createTestUser();
  await registerAndAuthenticate(intruder);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childBundle = accessManifestFromResponse(created);
  const childKek = kekStateFromResponse(created);
  const request = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: childKek,
    recipient,
    signer: intruder,
  });

  const response = await postMutation({
    path: `/containers/${created.containerId}/share`,
    request,
    token: intruder.token,
  });

  expect(response.status).toBe(403);
});

test("POST /containers/:containerId/share stores signed grants", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childBundle = accessManifestFromResponse(created);
  const childKek = kekStateFromResponse(created);
  const request = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: childKek,
    recipient,
    signer: owner,
  });
  const shared = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request,
      token: owner.token,
    }),
  );

  expect(shared.manifestHead.epoch).toBe(2);
  expect(shared.containerKek.containerKeyEpochId).toBe(
    created.containerKek.containerKeyEpochId,
  );
  expect(shared.containerKek.recipientTargets).toEqual([
    {
      recipientKind: "container",
      recipientId: root.kekState.containerId,
      recipientKeyEpochId: root.kekState.containerKeyEpochId,
      recipientKeyFingerprint: root.kekState.keyEpochHash,
    },
    {
      recipientKind: "user",
      recipientId: recipient.userId,
      recipientKeyEpochId: `user:${recipient.userId}:encapsulation:${await toFingerprint(
        recipient.kem.publicKey,
      )}`,
      recipientKeyFingerprint: await toFingerprint(recipient.kem.publicKey),
    },
  ]);
});

test("POST /containers/:containerId/share avoids downstream content-key fanout for additive grants", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const createdBundle = accessManifestFromResponse(created);
  const createdKek = kekStateFromResponse(created);
  const seededContentKeyRows = await seedDownstreamContentKeyRows({
    containerId: created.containerId,
    containerKeyEpoch: createdKek.containerKeyEpoch,
    containerKeyEpochId: createdKek.containerKeyEpochId,
    containerManifestHash: createdBundle.manifestHash,
    owner,
  });
  const baselineCounts =
    await countDownstreamContentKeyRows(seededContentKeyRows);
  expect(baselineCounts).toEqual({
    blobContentKeyEpochs: 1,
    blobContentKeyTargets: 1,
    documentContentKeyEpochs: 1,
    documentContentKeyTargets: 1,
  });
  const userGrantRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: createdBundle,
    previousContainerPath: [root.bundle, createdBundle],
    previousKekState: createdKek,
    recipient,
    signer: owner,
  });

  const sharedToUser = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request: userGrantRequest,
      token: owner.token,
    }),
  );

  expect(await countDownstreamContentKeyRows(seededContentKeyRows)).toEqual(
    baselineCounts,
  );
  expect(sharedToUser.containerKek.containerKeyEpochId).toBe(
    createdKek.containerKeyEpochId,
  );

  const userSharedBundle = accessManifestFromResponse(sharedToUser);
  const recipientKey = await userRecipientKey(recipient);
  const groupPrincipalId = crypto.randomUUID();
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    principalId: groupPrincipalId,
  });
  const groupGrantRequest = await buildGroupGrantRequest({
    containerManifestHistory: [createdBundle, userSharedBundle],
    parentKekState: root.kekState,
    previous: userSharedBundle,
    previousContainerPath: [root.bundle, userSharedBundle],
    previousKekState: kekStateFromResponse(sharedToUser),
    principalPolicy: group.policy,
    principalReference: group.reference,
    signer: owner,
    userRecipientKeys: [recipientKey],
  });

  const sharedToGroup = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request: groupGrantRequest,
      token: owner.token,
    }),
  );

  expect(await countDownstreamContentKeyRows(seededContentKeyRows)).toEqual(
    baselineCounts,
  );
  expect(sharedToGroup.containerKek.containerKeyEpochId).toBe(
    createdKek.containerKeyEpochId,
  );
});

test("POST /containers/:containerId/share stores group KEK targets and rejects stale group policy", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const directRecipient = createTestUser();
  await registerAndAuthenticate(directRecipient);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const createdBundle = accessManifestFromResponse(created);
  const directRecipientKey = await userRecipientKey(directRecipient);
  const userGrantRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: createdBundle,
    previousContainerPath: [root.bundle, createdBundle],
    previousKekState: kekStateFromResponse(created),
    recipient: directRecipient,
    signer: owner,
  });
  const userShared = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request: userGrantRequest,
      token: owner.token,
    }),
  );
  const userSharedBundle = accessManifestFromResponse(userShared);

  const groupPrincipalId = crypto.randomUUID();
  const initialGroup = await putGroupPrincipalPolicy({
    actor: owner,
    principalId: groupPrincipalId,
  });
  const groupGrantRequest = await buildGroupGrantRequest({
    containerManifestHistory: [createdBundle, userSharedBundle],
    parentKekState: root.kekState,
    previous: userSharedBundle,
    previousContainerPath: [root.bundle, userSharedBundle],
    previousKekState: kekStateFromResponse(userShared),
    principalPolicy: initialGroup.policy,
    principalReference: initialGroup.reference,
    signer: owner,
    userRecipientKeys: [directRecipientKey],
  });

  const shared = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request: groupGrantRequest,
      token: owner.token,
    }),
  );

  expect(shared.containerKek.containerKeyEpochId).toBe(
    userShared.containerKek.containerKeyEpochId,
  );
  expect(shared.referencedPrincipalHeads).toEqual([
    {
      principalType: "group",
      principalId: groupPrincipalId,
      version: initialGroup.reference.version,
      keyEpoch: initialGroup.reference.keyEpoch,
      stateHash: initialGroup.reference.stateHash,
      keyFingerprint: initialGroup.reference.keyFingerprint,
    },
  ]);
  expect(shared.containerKek.recipientTargets).toEqual([
    {
      recipientKind: "container",
      recipientId: root.kekState.containerId,
      recipientKeyEpochId: root.kekState.containerKeyEpochId,
      recipientKeyFingerprint: root.kekState.keyEpochHash,
    },
    {
      recipientKind: "group",
      recipientId: groupPrincipalId,
      recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
        initialGroup.reference,
      ),
      recipientKeyFingerprint: initialGroup.reference.keyFingerprint,
    },
    {
      recipientKind: "user",
      recipientId: directRecipient.userId,
      recipientKeyEpochId: directRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: directRecipientKey.recipientKeyFingerprint,
    },
  ]);

  const secondGroupPrincipalId = crypto.randomUUID();
  const secondGroup = await putGroupPrincipalPolicy({
    actor: owner,
    principalId: secondGroupPrincipalId,
    signedAt: "2026-04-30T00:00:30.000Z",
  });
  const sharedBundle = accessManifestFromResponse(shared);
  const secondGroupGrantRequest = await buildGroupGrantRequest({
    containerManifestHistory: [createdBundle, userSharedBundle, sharedBundle],
    parentKekState: root.kekState,
    previous: sharedBundle,
    previousContainerPath: [root.bundle, sharedBundle],
    previousKekState: kekStateFromResponse(shared),
    principalPolicies: [initialGroup.policy],
    principalPolicy: secondGroup.policy,
    principalReference: secondGroup.reference,
    signer: owner,
    userRecipientKeys: [directRecipientKey],
  });
  const secondGroupShared = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request: secondGroupGrantRequest,
      token: owner.token,
    }),
  );
  expect(secondGroupShared.containerKek.containerKeyEpochId).toBe(
    shared.containerKek.containerKeyEpochId,
  );
  expect(secondGroupShared.containerKek.recipientTargets).toHaveLength(4);
  expect(secondGroupShared.containerKek.recipientTargets).toContainEqual({
    recipientKind: "group",
    recipientId: groupPrincipalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
      initialGroup.reference,
    ),
    recipientKeyFingerprint: initialGroup.reference.keyFingerprint,
  });
  expect(secondGroupShared.containerKek.recipientTargets).toContainEqual({
    recipientKind: "group",
    recipientId: secondGroupPrincipalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
      secondGroup.reference,
    ),
    recipientKeyFingerprint: secondGroup.reference.keyFingerprint,
  });

  await putGroupPrincipalPolicy({
    actor: owner,
    keyEpoch: 2,
    prevStateHash: initialGroup.stateHash,
    principalId: groupPrincipalId,
    principalKem: generateKemSeedAndKeyPair(),
    signedAt: "2026-04-30T00:01:00.000Z",
    version: 2,
  });
  const secondChild = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const staleGroupGrantRequest = await buildGroupGrantRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromResponse(secondChild),
    previousContainerPath: [
      root.bundle,
      accessManifestFromResponse(secondChild),
    ],
    previousKekState: kekStateFromResponse(secondChild),
    principalPolicy: initialGroup.policy,
    principalReference: initialGroup.reference,
    signer: owner,
  });
  const staleResponse = await postMutation({
    path: `/containers/${secondChild.containerId}/share`,
    request: staleGroupGrantRequest,
    token: owner.token,
  });

  expect(staleResponse.status).toBe(409);
  expect(await staleResponse.json()).toEqual({
    error: "Principal policy is stale",
  });
});

test("POST /containers/:containerId/revoke advances the KEK epoch", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const shareRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromResponse(created),
    previousContainerPath: [root.bundle, accessManifestFromResponse(created)],
    previousKekState: kekStateFromResponse(created),
    recipient,
    signer: owner,
  });
  const shared = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request: shareRequest,
      token: owner.token,
    }),
  );
  const sharedBundle = accessManifestFromResponse(shared);
  const revokeRequest = await buildRevokeRequest({
    parentKekState: root.kekState,
    previous: sharedBundle,
    previousContainerPath: [root.bundle, sharedBundle],
    previousKekState: kekStateFromResponse(shared),
    revokedUser: recipient,
    signer: owner,
  });

  const revoked = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/revoke`,
      request: revokeRequest,
      token: owner.token,
    }),
  );

  expect(revoked.manifestHead.epoch).toBe(3);
  expect(revoked.containerKek.containerKeyEpoch).toBe(2);
  expect(revoked.containerKek.containerKeyEpochId).not.toBe(
    shared.containerKek.containerKeyEpochId,
  );
  expect(revoked.containerKek.recipientTargets).toEqual([
    {
      recipientKind: "container",
      recipientId: root.kekState.containerId,
      recipientKeyEpochId: root.kekState.containerKeyEpochId,
      recipientKeyFingerprint: root.kekState.keyEpochHash,
    },
  ]);
});

test("POST /containers/:containerId/rekey materializes a writer KEK rotation", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childBundle = accessManifestFromResponse(created);
  const childKek = kekStateFromResponse(created);
  const request = await buildRekeyRequest({
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: childKek,
    signer: owner,
  });

  const rekeyed = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/rekey`,
      request,
      token: owner.token,
    }),
  );

  expect(rekeyed.manifestHead.epoch).toBe(2);
  expect(rekeyed.parentId).toBe(root.kekState.containerId);
  expect(rekeyed.containerKek.containerKeyEpoch).toBe(
    childKek.containerKeyEpoch + 1,
  );
  expect(rekeyed.containerKek.containerKeyEpochId).not.toBe(
    childKek.containerKeyEpochId,
  );
  expect(rekeyed.containerKek.recipientTargets).toEqual([
    {
      recipientKind: "container",
      recipientId: root.kekState.containerId,
      recipientKeyEpochId: root.kekState.containerKeyEpochId,
      recipientKeyFingerprint: root.kekState.keyEpochHash,
    },
  ]);
});

test("POST /containers/:containerId/move validates destination manifest heads", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const source = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const destination = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const destinationShareRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromResponse(destination),
    previousContainerPath: [
      root.bundle,
      accessManifestFromResponse(destination),
    ],
    previousKekState: kekStateFromResponse(destination),
    recipient,
    signer: owner,
  });
  const updatedDestination = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${destination.containerId}/share`,
      request: destinationShareRequest,
      token: owner.token,
    }),
  );

  const staleMoveRequest = await buildMoveRequest({
    destinationParent: accessManifestFromResponse(destination),
    destinationParentKekState: kekStateFromResponse(destination),
    destinationParentPath: [
      root.bundle,
      accessManifestFromResponse(destination),
    ],
    previous: accessManifestFromResponse(source),
    previousContainerPath: [root.bundle, accessManifestFromResponse(source)],
    previousKekState: kekStateFromResponse(source),
    signer: owner,
  });
  const staleResponse = await postMutation({
    path: `/containers/${source.containerId}/move`,
    request: staleMoveRequest,
    token: owner.token,
  });
  expect(staleResponse.status).toBe(409);

  const moveRequest = await buildMoveRequest({
    destinationParent: accessManifestFromResponse(updatedDestination),
    destinationParentKekState: kekStateFromResponse(updatedDestination),
    destinationParentPath: [
      root.bundle,
      accessManifestFromResponse(updatedDestination),
    ],
    previous: accessManifestFromResponse(source),
    previousContainerPath: [root.bundle, accessManifestFromResponse(source)],
    previousKekState: kekStateFromResponse(source),
    signer: owner,
  });
  const moved = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${source.containerId}/move`,
      request: moveRequest,
      token: owner.token,
    }),
  );

  expect(moved.parentId).toBe(destination.containerId);
  expect(moved.containerKek.parentContainerKeyEpochId).toBe(
    updatedDestination.containerKek.containerKeyEpochId,
  );
});
