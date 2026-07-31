import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containers, organizations, users } from "@tearleads/api-shared/schema";
import type { TestUser } from "@tearleads/bob-and-alice";
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
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeContainerKekPredecessorBridgeHash,
  computeDocumentContentKeyTargetHash,
  deriveContainerAccessManifest,
  deriveDocumentLinkSetManifest,
  signAccessEvent,
  toFingerprint,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
  DocumentCreateRequest,
} from "@tearleads/validators/request";
import {
  type ContainerMutationResponse,
  type DocumentCreateResponse,
  isDocumentCreateResponse,
} from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { getAccessManifestBundle } from "../../src/access/read/accessManifestStore";
import {
  getCurrentContainerKeyEpoch,
  listContainerKeyWraps,
} from "../../src/access/read/containerKekStore";
import { routeApp } from "../../src/routeApp";
import {
  createRootContainerKeyEpoch,
  createTestContainerKekMaterial,
  createTestContainerKekPredecessorBridge,
} from "./containerKekMaterial";
import { loadVerifiedPrincipalPolicy } from "./principalPolicy";

interface RootContainerFixture {
  readonly adminGroupId: string;
  readonly id: string;
  readonly organizationId: string;
}

export interface StoredRootFixture {
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

export function asVerifiedContainerManifest(
  bundle: AccessManifestBundleWire,
): VerifiedContainerAccessManifest {
  return bundle as unknown as VerifiedContainerAccessManifest;
}

export async function createSignedAccessEvent(input: {
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
  readonly userRecipientKeys?: readonly ContainerUserRecipientKey[];
  readonly wraps: readonly ContainerKeyWrap[];
}): Promise<VerifiedContainerKekState> {
  const verified = await verifyContainerKekState({
    containerManifest: asVerifiedContainerManifest(input.bundle),
    keyEpoch: input.keyEpoch,
    principalPolicies: input.principalPolicies ?? [],
    userRecipientKeys: input.userRecipientKeys ?? [],
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

function principalPolicyKey(policy: VerifiedPrincipalPolicy): string {
  return [
    policy.principalType,
    policy.principalId,
    policy.version,
    policy.stateHash,
  ].join(":");
}

export function uniquePrincipalPolicies(
  policies: readonly VerifiedPrincipalPolicy[],
): VerifiedPrincipalPolicy[] {
  const policiesByKey = new Map<string, VerifiedPrincipalPolicy>();

  for (const policy of policies) {
    policiesByKey.set(principalPolicyKey(policy), policy);
  }

  return [...policiesByKey.values()];
}

export async function loadPrincipalPoliciesForContainerPath(
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

  return uniquePrincipalPolicies(principalPolicies);
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

function userRecipientKeysFromRecipientTargets(
  recipientTargets: readonly VerifiedContainerKekState["recipientTargets"][number][],
): ContainerUserRecipientKey[] {
  return recipientTargets
    .filter((target) => target.recipientKind === "user")
    .map((target) => ({
      userId: target.recipientId,
      recipientKeyEpochId: target.recipientKeyEpochId,
      recipientKeyFingerprint: target.recipientKeyFingerprint,
    }));
}

function userRecipientKeysFromKekTargets(
  kekState: VerifiedContainerKekState,
): ContainerUserRecipientKey[] {
  return userRecipientKeysFromRecipientTargets(kekState.recipientTargets);
}

function createContainerKeyWrapForRecipientTarget(input: {
  readonly containerKeyEpochId: string;
  readonly recipientTarget: VerifiedContainerKekState["recipientTargets"][number];
  readonly wrapManifestHash: string;
}): ContainerKeyWrap {
  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: input.recipientTarget.recipientKind,
    recipientId: input.recipientTarget.recipientId,
    recipientKeyEpochId: input.recipientTarget.recipientKeyEpochId,
    recipientKeyFingerprint: input.recipientTarget.recipientKeyFingerprint,
    kemCipherText: `kem:${input.containerKeyEpochId}:${input.recipientTarget.recipientId}`,
    wrappedKey: `wrapped:${input.containerKeyEpochId}:${input.recipientTarget.recipientId}`,
    wrapManifestHash: input.wrapManifestHash,
  };
}

export async function bootstrapRoot(
  owner: TestUser,
): Promise<StoredRootFixture> {
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

export function accessManifestFromContainerResponse(
  response: ContainerMutationResponse,
): AccessManifestBundleWire {
  return response.accessManifest as unknown as AccessManifestBundleWire;
}

export function kekStateFromContainerResponse(
  response: ContainerMutationResponse,
): VerifiedContainerKekState {
  return response.containerKek as unknown as VerifiedContainerKekState;
}

export async function createContainerManifestBundle(
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

export function createContainerKeyEpoch(input: {
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

export function createContainerKeyWrap(input: {
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

export async function createDocumentRequest(input: {
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

export async function createDocument(input: {
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

export async function buildRootGrantRequest(input: {
  readonly previous: AccessManifestBundleWire;
  readonly previousKekState: VerifiedContainerKekState;
  readonly accessLevel?: "read" | "write" | "admin";
  readonly recipient: TestUser;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const recipientKey = await userRecipientKey(input.recipient);
  const principalPolicies = await loadPrincipalPoliciesForContainerPath([
    input.previous,
  ]);
  const grant = {
    subjectType: "user" as const,
    subjectId: input.recipient.userId,
    accessLevel: input.accessLevel ?? ("write" as const),
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
    principalPolicies: principalPolicies as unknown as Record<
      string,
      unknown
    >[],
    keyEpoch: input.previousKekState.keyEpoch as unknown as Record<
      string,
      unknown
    >,
    predecessorBridge: null,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: null,
    userRecipientKeys: [
      ...userRecipientKeysFromKekTargets(input.previousKekState),
      recipientKey as unknown as Record<string, unknown>,
    ] as unknown as Record<string, unknown>[],
  };
}

export async function buildRootRevokeRequest(input: {
  readonly previous: AccessManifestBundleWire;
  readonly previousKekState: VerifiedContainerKekState;
  readonly revokedUser: TestUser;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const principalPolicies = await loadPrincipalPoliciesForContainerPath([
    input.previous,
  ]);
  const nextKeyEpoch = input.previousKekState.containerKeyEpoch + 1;
  const { containerKeyEpochId } = await createTestContainerKekMaterial({
    containerId: previous.state.containerId,
    keyEpoch: nextKeyEpoch,
  });
  const predecessorBridge = await createTestContainerKekPredecessorBridge({
    containerId: previous.state.containerId,
    predecessorContainerKeyEpochId: input.previousKekState.containerKeyEpochId,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  const body: ContainerAccessEventBody = {
    eventType: "container.revoke",
    containerKeyEpochId,
    predecessorBridgeHash:
      await computeContainerKekPredecessorBridgeHash(predecessorBridge),
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
    keyEpoch: nextKeyEpoch,
    manifest: bundle,
  });
  const recipientTargets = input.previousKekState.recipientTargets.filter(
    (target) =>
      target.recipientKind !== "user" ||
      target.recipientId !== input.revokedUser.userId,
  );
  const wraps: ContainerKeyWrap[] = recipientTargets.map((recipientTarget) =>
    createContainerKeyWrapForRecipientTarget({
      containerKeyEpochId,
      recipientTarget,
      wrapManifestHash: bundle.manifestHash,
    }),
  );
  const kekState = await verifyKekState({
    bundle,
    keyEpoch,
    principalPolicies,
    userRecipientKeys: userRecipientKeysFromRecipientTargets(recipientTargets),
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
    principalPolicies: principalPolicies as unknown as Record<
      string,
      unknown
    >[],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    predecessorBridge: predecessorBridge as unknown as Record<string, unknown>,
    wraps: kekState.wraps as unknown as Record<string, unknown>[],
    parentKekState: null,
    userRecipientKeys: userRecipientKeysFromKekTargets(
      kekState,
    ) as unknown as Record<string, unknown>[],
  };
}
