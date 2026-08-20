import { test as bunTest, expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobContentKeyEpochs,
  blobContentKeyTargets,
  blobs,
  containerMetadataDocuments,
  containerSyncTombstones,
  containers,
  documentContainerLinks,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documents,
  organizationBilling,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type {
  AccessEvent,
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  DocumentLinkAccessEventBody,
  DocumentLinkSetManifestState,
  KeyingCanonicalJson,
  PrincipalContainerGrant,
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
  computeAccessEventHash,
  computeAccessManifestHash,
  computeDocumentContentKeyTargetHash,
  computePrincipalStateHash,
  deriveContainerAccessManifest,
  deriveDocumentLinkSetManifest,
  derivePrincipalRecipientKeyEpochId,
  generateKemSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
  signAccessEvent,
  toFingerprint,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
  DocumentCreateRequest,
} from "@tearleads/validators/request";
import {
  type ContainerMutationResponse,
  isContainerCreateWithMetadataDocumentResponse,
  isContainerDeleteResponse,
  isContainerMutationResponse,
  type PrincipalPolicyMutationResponse,
} from "@tearleads/validators/response";
import { and, eq, inArray, isNull } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  createTestContainerKekId,
  createTestContainerKekPredecessorBridge,
} from "../../../test/helpers/containerKekMaterial";
import {
  createContainerKeyEpoch,
  createContainerKeyWrap,
} from "../../../test/helpers/containerKeying";
import {
  buildMoveRequest,
  buildRekeyRequest,
  buildRevokeRequest,
} from "../../../test/helpers/containerMutationRotations";
import {
  firstContainerTombstone as firstTombstone,
  requestSingleContainerParentLane as listContainersForUser,
  readContainerParentLanePage as readLanePage,
} from "../../../test/helpers/containerParentLaneQuery";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import {
  setTestOrganizationBillingExpiredTrial,
  setTestOrganizationBillingLocal,
} from "../../../test/helpers/organizationBilling";
import * as grants from "../../../test/helpers/organizationGrantChanges";
import {
  addOrganizationMember,
  getDefaultOrganizationId,
  joinOrg,
} from "../../../test/helpers/organizationMembership";
import { createPrincipalMemberEnvelopes } from "../../../test/helpers/principalMemberEnvelopes";
import {
  loadVerifiedPrincipalPolicy,
  submitOrganizationGroupPolicyCommit,
  withOrganizationGroupDirectoryPolicy,
} from "../../../test/helpers/principalPolicy";
import {
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
} from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import { getAccessManifestBundle } from "../../access/read/accessManifestStore";
import {
  getCurrentContainerKeyEpoch,
  listContainerKeyWraps,
} from "../../access/read/containerKekStore";
import { routeApp } from "../../routeApp";

interface RootContainerFixture {
  readonly adminGroupId: string;
  readonly id: string;
  readonly organizationId: string;
}

interface StoredContainerFixture {
  readonly bundle: AccessManifestBundleWire;
  readonly kekState: VerifiedContainerKekState;
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly userKey?: ContainerUserRecipientKey;
}

interface DownstreamContentKeyRowCounts {
  readonly blobContentKeyEpochs: number;
  readonly blobContentKeyTargets: number;
  readonly documentContentKeyEpochs: number;
  readonly documentContentKeyTargets: number;
}

const TEST_CONTACTS_SYSTEM_SLOT =
  "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

type TestCallback = () => Promise<void> | void;

function test(name: string, run: TestCallback): void {
  bunTest(name, run, 10_000);
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
  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, rootContainer.organizationId))
    .limit(1);
  invariant(organization, "expected registered organization");

  return { ...rootContainer, adminGroupId: organization.adminGroupId };
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
  bundle: AccessManifestBundleWire,
): VerifiedContainerAccessManifest {
  return bundle as unknown as VerifiedContainerAccessManifest;
}

function accessManifestFromResponse(
  response: ContainerMutationResponse,
): AccessManifestBundleWire {
  return response.accessManifest as unknown as AccessManifestBundleWire;
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
): Promise<AccessManifestBundleWire> {
  const manifest = await deriveContainerAccessManifest(state);

  return {
    event: event as unknown as Record<string, unknown>,
    manifest: manifest as unknown as Record<string, unknown>,
    manifestHash: await computeAccessManifestHash(manifest),
    state: state as unknown as Record<string, unknown>,
  };
}

async function verifyKekState(input: {
  readonly bundle: AccessManifestBundleWire;
  readonly containerManifestHistory?: readonly AccessManifestBundleWire[];
  readonly keyEpoch: ContainerKeyEpoch;
  readonly parentKekState?: VerifiedContainerKekState | null;
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
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
    principalPolicies: input.principalPolicies ?? [],
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
  readonly containerMutations?: readonly ContainerMutationRequest[];
  readonly grants?: readonly PrincipalContainerGrant[];
  readonly keyEpoch?: number;
  readonly members?: readonly PrincipalStateMember[];
  readonly prevStateHash?: string | null;
  readonly principalId: string;
  readonly principalKem?: ReturnType<typeof generateKemSeedAndKeyPair>;
  readonly prepareContainerMutations?: (input: {
    readonly policy: VerifiedPrincipalPolicy;
    readonly reference: ReferencedPrincipalHead;
  }) => Promise<readonly ContainerMutationRequest[]>;
  readonly projection?: readonly PrincipalProjectionMember[];
  readonly signedAt?: string;
  readonly version?: number;
}): Promise<{
  readonly containerMutations: readonly ContainerMutationResponse[];
  readonly policy: VerifiedPrincipalPolicy;
  readonly reference: ReferencedPrincipalHead;
  readonly stateHash: string;
}> {
  const principalKem = input.principalKem ?? generateKemSeedAndKeyPair();
  const members = [...(input.members ?? [{ userId: input.actor.userId }])];
  const projection = [
    ...(input.projection ??
      createProjectionWithAdminSigner(input.actor.userId, members)),
  ];
  const isInitialState =
    (input.version ?? 1) === 1 && (input.prevStateHash ?? null) === null;
  const currentPolicy = isInitialState
    ? null
    : await loadVerifiedPrincipalPolicy(db, "group", input.principalId);
  const policyGrants = input.grants ?? currentPolicy?.grants ?? [];
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: principalKem.secretKey,
      projection,
    });
  const signedState = await signPrincipalStateBundle({
    principalType: "group",
    principalId: input.principalId,
    version: input.version ?? 1,
    prevStateHash: input.prevStateHash ?? null,
    keyEpoch: input.keyEpoch ?? 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: stateMembers,
    projection,
    grants: [...policyGrants],
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(JSON.stringify({ members: projection })),
    ),
    signedAt:
      input.signedAt ?? new Date("2026-04-30T00:00:00.000Z").toISOString(),
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
    memberEnvelopes,
  });
  const stateHash = await computePrincipalStateHash(signedState.state);
  let preparedContainerMutations = input.containerMutations;
  if (input.prepareContainerMutations) {
    invariant(!isInitialState, "initial groups have no successor history");
    invariant(
      !input.containerMutations,
      "provide either container mutations or a mutation preparer",
    );
    invariant(currentPolicy, "expected current group policy");
    const nextState = {
      ...signedState.state,
      stateHash,
      createdAt: signedState.state.signedAt,
    };
    const nextPolicy = makeVerifiedPrincipalPolicy({
      principalType: nextState.principalType,
      principalId: nextState.principalId,
      version: nextState.version,
      keyEpoch: nextState.keyEpoch,
      stateHash,
      state: nextState,
      projection: signedState.projection,
      grants: signedState.grants,
      history: [
        {
          state: currentPolicy.state,
          projection: currentPolicy.projection,
          grants: currentPolicy.grants,
        },
        {
          state: nextState,
          projection: signedState.projection,
          grants: signedState.grants,
        },
      ],
      checkpoint: {
        principalType: nextState.principalType,
        principalId: nextState.principalId,
        version: nextState.version,
        stateHash,
      },
    });
    preparedContainerMutations = await input.prepareContainerMutations({
      policy: nextPolicy,
      reference: {
        principalType: nextPolicy.principalType,
        principalId: nextPolicy.principalId,
        version: nextPolicy.version,
        keyEpoch: nextPolicy.keyEpoch,
        stateHash: nextPolicy.stateHash,
        keyFingerprint: nextPolicy.state.keyFingerprint,
      },
    });
  }
  const policyRequest = {
    state: signedState.state,
    encryptedPayload: signedState.encryptedPayload,
    projection: signedState.projection,
    grants: signedState.grants,
    memberEnvelopes: signedState.memberEnvelopes,
    ...(preparedContainerMutations
      ? { containerMutations: [...preparedContainerMutations] }
      : {}),
  };
  let response: Response;
  if (isInitialState) {
    const [actor] = await db
      .select({ organizationId: users.defaultOrganizationId })
      .from(users)
      .where(eq(users.id, input.actor.userId))
      .limit(1);
    invariant(actor, "expected registered actor");
    response = await routeApp.request(
      `/organizations/${actor.organizationId}/groups`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.actor.token}`,
        },
        body: JSON.stringify({
          ...(await withOrganizationGroupDirectoryPolicy({
            actor: input.actor,
            organizationId: actor.organizationId,
            request: {
              groupId: input.principalId,
              name: "Test group",
              initialGroupPolicy: policyRequest,
            },
          })),
        }),
      },
    );
  } else {
    response = await submitOrganizationGroupPolicyCommit({
      actor: input.actor,
      groupId: input.principalId,
      groupPolicy: policyRequest,
      organizationId: await getDefaultOrganizationId(input.actor.userId),
    });
  }

  expect(response.status, await response.clone().text()).toBe(200);
  const responseBody = isInitialState
    ? null
    : (
        (await response.json()) as {
          groupPolicy: PrincipalPolicyMutationResponse;
        }
      ).groupPolicy;
  const policy = await loadVerifiedPrincipalPolicy(
    db,
    "group",
    input.principalId,
  );
  expect(policy.stateHash).toBe(stateHash);
  const reference: ReferencedPrincipalHead = {
    principalType: "group",
    principalId: input.principalId,
    version: policy.version,
    keyEpoch: policy.keyEpoch,
    stateHash,
    keyFingerprint: policy.state.keyFingerprint,
  };

  return {
    containerMutations: responseBody?.containerMutations ?? [],
    policy,
    reference,
    stateHash,
  };
}

async function commitGroupGrant(input: {
  readonly accessLevel?: "admin" | "read" | "write";
  readonly actor: TestUser;
  readonly buildMutation: (input: {
    readonly policy: VerifiedPrincipalPolicy;
    readonly reference: ReferencedPrincipalHead;
  }) => Promise<ContainerMutationRequest>;
  readonly containerId: string;
  readonly current: Awaited<ReturnType<typeof putGroupPrincipalPolicy>>;
  readonly signedAt?: string;
}) {
  const nextGrants = [
    ...input.current.policy.grants.filter(
      (grant) => grant.containerId !== input.containerId,
    ),
    {
      accessLevel: input.accessLevel ?? ("read" as const),
      containerId: input.containerId,
    },
  ];
  return putGroupPrincipalPolicy({
    actor: input.actor,
    grants: nextGrants,
    keyEpoch: input.current.policy.keyEpoch + 1,
    members: input.current.policy.projection.map((member) => ({
      userId: member.userId,
    })),
    prevStateHash: input.current.stateHash,
    principalId: input.current.policy.principalId,
    projection: [...input.current.policy.projection],
    prepareContainerMutations: async (next) => [
      await input.buildMutation(next),
    ],
    ...(input.signedAt ? { signedAt: input.signedAt } : {}),
    version: input.current.policy.version + 1,
  });
}

function firstCompoundMutation(
  result: Awaited<ReturnType<typeof putGroupPrincipalPolicy>>,
): ContainerMutationResponse {
  const mutation = result.containerMutations[0];
  invariant(mutation, "expected compound principal container mutation");
  return mutation;
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
  const storedKeyEpoch = await getCurrentContainerKeyEpoch(
    rootContainer.id,
    db,
  );
  const keyEpoch = toStoredContainerKeyEpoch(storedKeyEpoch);
  const bundle = await getAccessManifestBundle(keyEpoch.accessManifestHash, db);
  invariant(bundle, "expected registered root container manifest");
  const wraps = (await listContainerKeyWraps(keyEpoch.id, db)).map(
    toStoredContainerKeyWrap,
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

function principalPolicyKey(policy: VerifiedPrincipalPolicy): string {
  return [
    policy.principalType,
    policy.principalId,
    policy.version,
    policy.stateHash,
  ].join(":");
}

function uniquePrincipalPolicies(
  policies: readonly VerifiedPrincipalPolicy[],
): VerifiedPrincipalPolicy[] {
  const policiesByKey = new Map<string, VerifiedPrincipalPolicy>();

  for (const policy of policies) {
    policiesByKey.set(principalPolicyKey(policy), policy);
  }

  return [...policiesByKey.values()];
}

async function loadPrincipalPoliciesForContainerPaths(
  paths: readonly (readonly AccessManifestBundleWire[])[],
): Promise<VerifiedPrincipalPolicy[]> {
  const principalPolicies = await Promise.all(
    paths.flatMap((path) =>
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
    ),
  );

  return uniquePrincipalPolicies(principalPolicies);
}

function userRecipientKeysFromKekTargets(
  kekState: VerifiedContainerKekState,
): ContainerUserRecipientKey[] {
  return kekState.recipientTargets
    .filter((target) => target.recipientKind === "user")
    .map((target) => ({
      userId: target.recipientId,
      recipientKeyEpochId: target.recipientKeyEpochId,
      recipientKeyFingerprint: target.recipientKeyFingerprint,
    }));
}

async function buildCreateRequest(input: {
  readonly containerId: string;
  readonly dependencyManifestHashesOverride?: readonly string[];
  readonly parent: AccessManifestBundleWire;
  readonly parentContainerPath?: readonly AccessManifestBundleWire[];
  readonly parentKekState: VerifiedContainerKekState;
  readonly parentManifestHashOverride?: string;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const parent = asVerifiedContainerManifest(input.parent);
  const parentContainerPath = input.parentContainerPath ?? [input.parent];
  const containerKeyEpochId = await createTestContainerKekId(
    input.containerId,
    1,
  );
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
      ...new Set(parentContainerPath.map((manifest) => manifest.manifestHash)),
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
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths([
    parentContainerPath,
  ]);

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    parentContainerPath: [...parentContainerPath],
    principalPolicies: principalPolicies as unknown as Record<
      string,
      unknown
    >[],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    keyring: null,
    predecessorBridge: null,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<string, unknown>,
    userRecipientKeys: [],
  };
}

async function buildMetadataDocumentCreateRequest(input: {
  readonly containerId: string;
  readonly containerRequest: ContainerMutationRequest;
  readonly parent: AccessManifestBundleWire;
  readonly signer: TestUser;
}): Promise<DocumentCreateRequest> {
  const parentState = asVerifiedContainerManifest(input.parent).state;
  const containerBody = input.containerRequest.body as {
    readonly containerKeyEpochId: string;
    readonly metadataDocumentId: string;
    readonly parentContainerId: string;
    readonly parentManifestHash: string;
  };
  const containerEventHash = await computeAccessEventHash(
    input.containerRequest.event as unknown as AccessEvent,
  );
  const childBundle: AccessManifestBundleWire = {
    event: {
      event: input.containerRequest.event,
      body: input.containerRequest.body,
      eventHash: containerEventHash,
    },
    manifest: input.containerRequest.manifest,
    manifestHash: input.containerRequest.expectedManifestHash,
    state: {
      version: 1,
      containerId: input.containerId,
      organizationId: parentState.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash: containerEventHash,
      parentContainerId: containerBody.parentContainerId,
      parentManifestHash: containerBody.parentManifestHash,
      metadataDocumentId: containerBody.metadataDocumentId,
      containerKeyEpochId: containerBody.containerKeyEpochId,
      directGrants: [],
      referencedPrincipalHeads: [],
    },
  };
  const target = {
    containerId: input.containerId,
    containerManifestHash: childBundle.manifestHash,
    containerKeyEpochId: containerBody.containerKeyEpochId,
    containerKeyEpoch: 1,
  };
  const body: DocumentLinkAccessEventBody = {
    eventType: "document.link",
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
  };
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: "document.link",
      objectKind: "document",
      objectId: containerBody.metadataDocumentId,
      organizationId: parentState.organizationId,
      previousManifestHash: null,
      dependencyManifestHashes: [target.containerManifestHash],
      bodyHash: await computeAccessEventBodyHash(
        body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: input.signer.userId,
      signerDeviceId: "test-device",
      signerKeyFingerprint: input.signer.fingerprint,
      signedAt: "2026-04-26T12:00:00.000Z",
    },
    input.signer.signing.signingPrivateKey,
  );
  const eventHash = await computeAccessEventHash(event);
  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId: containerBody.metadataDocumentId,
    organizationId: parentState.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    linkedContainerIds: [target.containerId],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const targetHash = await computeDocumentContentKeyTargetHash([target]);

  return {
    event: event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: manifestHash,
    manifest: manifest as unknown as Record<string, unknown>,
    previousManifest: null,
    targetContainerPathRefs: [
      {
        containerId: parentState.containerId,
        manifestHash: input.parent.manifestHash,
      },
      {
        containerId: target.containerId,
        manifestHash: childBundle.manifestHash,
      },
    ],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: [
        {
          ...target,
          wrappedKey: `metadata-document-key:${containerBody.metadataDocumentId}`,
          wrappingMetadata: { alg: "test-wrap" },
        },
      ],
    },
  };
}

async function buildGrantRequest(input: {
  readonly parentKekState: VerifiedContainerKekState;
  readonly previous: AccessManifestBundleWire;
  readonly previousContainerPath: readonly AccessManifestBundleWire[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly recipient: TestUser;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  await joinOrg(previous.state.organizationId, input.signer, input.recipient);
  const recipientKey = await userRecipientKey(input.recipient);
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths([
    input.previousContainerPath,
  ]);
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
    event: event.event,
    body,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [...input.previousContainerPath],
    containerManifestHistory: [input.previous],
    principalPolicies,
    keyEpoch: input.previousKekState.keyEpoch,
    keyring: null,
    predecessorBridge: null,
    wraps,
    parentKekState: input.parentKekState,
    userRecipientKeys: [
      ...userRecipientKeysFromKekTargets(input.previousKekState),
      recipientKey,
    ],
  } as unknown as ContainerMutationRequest;
}

async function buildGroupGrantRequest(input: {
  readonly accessLevel?: "admin" | "read" | "write";
  readonly containerManifestHistory?: readonly AccessManifestBundleWire[];
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly previous: AccessManifestBundleWire;
  readonly previousContainerPath: readonly AccessManifestBundleWire[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly principalPolicy: VerifiedPrincipalPolicy;
  readonly principalReference: ReferencedPrincipalHead;
  readonly signer: TestUser;
  readonly userRecipientKeys?: readonly ContainerUserRecipientKey[];
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const principalPolicies = uniquePrincipalPolicies([
    ...(await loadPrincipalPoliciesForContainerPaths([
      input.previousContainerPath,
    ])),
    ...(input.principalPolicies ?? []),
    input.principalPolicy,
  ]);
  const grant = {
    subjectType: "group" as const,
    subjectId: input.principalReference.principalId,
    accessLevel: input.accessLevel ?? ("read" as const),
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
      directGrants: [
        ...previous.state.directGrants.filter(
          (existingGrant) =>
            existingGrant.subjectType !== grant.subjectType ||
            existingGrant.subjectId !== grant.subjectId,
        ),
        grant,
      ],
      referencedPrincipalHeads: [
        ...previous.state.referencedPrincipalHeads.filter(
          (existingHead) =>
            existingHead.principalType !==
              input.principalReference.principalType ||
            existingHead.principalId !== input.principalReference.principalId,
        ),
        input.principalReference,
      ],
    },
    event,
  );
  const wraps = [
    ...(input.previousKekState.wraps as readonly ContainerKeyWrap[]).filter(
      (existingWrap) =>
        existingWrap.recipientKind !== "group" ||
        existingWrap.recipientId !== input.principalReference.principalId,
    ),
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
    keyring: null,
    predecessorBridge: null,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<
      string,
      unknown
    > | null,
    userRecipientKeys: (input.userRecipientKeys ?? []) as unknown as Record<
      string,
      unknown
    >[],
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

async function postJson(input: {
  readonly path: string;
  readonly request: unknown;
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

async function deleteContainerForUser(input: {
  readonly containerId: string;
  readonly token: string;
}): Promise<Response> {
  return routeApp.request(`/containers/${input.containerId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${input.token}`,
    },
  });
}

async function listRootContainers(input: {
  readonly token: string;
  readonly watermark?: { id: string; updatedAt: string } | null;
}): Promise<Response> {
  return listContainersForUser({ ...input, parentId: null });
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
  readonly parent: AccessManifestBundleWire;
  readonly parentContainerPath?: readonly AccessManifestBundleWire[];
  readonly parentKekState: VerifiedContainerKekState;
  readonly signer: TestUser;
}): Promise<ContainerMutationResponse> {
  const request = await buildCreateRequest({
    containerId: input.containerId ?? crypto.randomUUID(),
    parent: input.parent,
    ...(input.parentContainerPath === undefined
      ? {}
      : { parentContainerPath: input.parentContainerPath }),
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

test("POST /containers rejects a predecessor bridge on its initial KEK epoch", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const containerId = crypto.randomUUID();
  const request = await buildCreateRequest({
    containerId,
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const initialKeyEpochId = String(Reflect.get(request.keyEpoch, "id"));
  request.predecessorBridge = (await createTestContainerKekPredecessorBridge({
    containerId,
    predecessorContainerKeyEpochId: initialKeyEpochId,
    successorContainerKeyEpochId: await createTestContainerKekId(
      containerId,
      2,
    ),
  })) as unknown as Record<string, unknown>;

  const response = await postMutation({
    path: "/containers",
    request,
    token: owner.token,
  });
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({
    error: "Initial container KEK epoch cannot have rotation artifacts",
  });
});

test("POST /containers is rejected with 402 when the organization cannot sync", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);

  const [ownerRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId));
  invariant(ownerRow, "expected registered owner row");
  await setTestOrganizationBillingLocal(ownerRow.organizationId);

  const containerId = crypto.randomUUID();
  const request = await buildCreateRequest({
    containerId,
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const response = await postMutation({
    path: "/containers",
    request,
    token: owner.token,
  });
  expect(response.status).toBe(402);
  await expect(response.json()).resolves.toEqual({
    error: "Organization sync is not active",
    organizationId: ownerRow.organizationId,
    reason: "billing_inactive",
  });

  // The mutation rolled back: no new container was persisted.
  const containerRows = await db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.id, containerId));
  expect(containerRows).toHaveLength(0);
});

test("POST /containers rejects an active organization user without a sync seat", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);

  const [ownerRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId));
  invariant(ownerRow, "expected registered owner row");
  await setTestOrganizationBillingLocal(ownerRow.organizationId);
  await db
    .update(organizationBilling)
    .set({
      currentPeriodEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      currentPeriodStartsAt: new Date("2098-12-01T00:00:00.000Z"),
      seatCount: 1,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, ownerRow.organizationId));

  const containerId = crypto.randomUUID();
  const request = await buildCreateRequest({
    containerId,
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const response = await postMutation({
    path: "/containers",
    request,
    token: owner.token,
  });
  expect(response.status).toBe(402);
  await expect(response.json()).resolves.toEqual({
    error: "No sync seat is assigned to this user",
    organizationId: ownerRow.organizationId,
    reason: "sync_seat_unassigned",
  });

  const containerRows = await db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.id, containerId));
  expect(containerRows).toHaveLength(0);
});

test("batch reads work with sync disabled", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  const beforeResponse = await listContainersForUser({
    parentId: owner.rootContainerId,
    token: owner.token,
  });
  const before = await readLanePage(beforeResponse);
  expect(
    before.items.map((container: { id: string }) => container.id),
  ).toContain(child.containerId);

  const [ownerRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId));
  invariant(ownerRow, "expected registered owner row");
  await setTestOrganizationBillingLocal(ownerRow.organizationId);

  const afterResponse = await listContainersForUser({
    parentId: owner.rootContainerId,
    token: owner.token,
  });
  expect(afterResponse.status).toBe(200);
  const after = await readLanePage(afterResponse);
  expect(
    after.items.map((container: { id: string }) => container.id),
  ).toContain(child.containerId);
});

test("batch reads work before expired-trial disablement", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  const [ownerRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId));
  invariant(ownerRow, "expected registered owner row");
  // Still `trialing` in the row, but past `trialEndsAt`: reads stay available
  // while writes/syncs use the billing gate.
  await setTestOrganizationBillingExpiredTrial(ownerRow.organizationId);

  const afterResponse = await listContainersForUser({
    parentId: owner.rootContainerId,
    token: owner.token,
  });
  expect(afterResponse.status).toBe(200);
  const after = await readLanePage(afterResponse);
  expect(
    after.items.map((container: { id: string }) => container.id),
  ).toContain(child.containerId);
});

test("POST /containers/with-metadata-document creates container and metadata document atomically", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const containerId = crypto.randomUUID();
  const containerRequest = await buildCreateRequest({
    containerId,
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const metadataDocumentRequest = await buildMetadataDocumentCreateRequest({
    containerId,
    containerRequest,
    parent: root.bundle,
    signer: owner,
  });

  const response = await postJson({
    path: "/containers/with-metadata-document",
    request: {
      systemSlot: TEST_CONTACTS_SYSTEM_SLOT,
      container: containerRequest,
      metadataDocument: metadataDocumentRequest,
    },
    token: owner.token,
  });

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(isContainerCreateWithMetadataDocumentResponse(body)).toBe(true);
  if (!isContainerCreateWithMetadataDocumentResponse(body)) {
    throw new Error("expected composite container metadata response");
  }
  expect(body.container.containerId).toBe(containerId);
  expect(body.container.systemSlot).toBe(TEST_CONTACTS_SYSTEM_SLOT);
  expect(body.metadataDocument.id).toBe(
    (containerRequest.body as { readonly metadataDocumentId: string })
      .metadataDocumentId,
  );

  const [metadataBinding] = await db
    .select({
      containerId: containerMetadataDocuments.containerId,
      documentId: containerMetadataDocuments.documentId,
    })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.containerId, containerId))
    .limit(1);
  expect(metadataBinding).toEqual({
    containerId,
    documentId: body.metadataDocument.id,
  });
  const [containerRow] = await db
    .select({
      systemSlot: containers.systemSlot,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);
  expect(containerRow).toEqual({
    systemSlot: TEST_CONTACTS_SYSTEM_SLOT,
    parentId: owner.rootContainerId,
  });

  const [documentLink] = await db
    .select({
      containerId: documentContainerLinks.containerId,
      documentId: documentContainerLinks.documentId,
    })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, body.metadataDocument.id))
    .limit(1);
  expect(documentLink).toEqual({
    containerId,
    documentId: body.metadataDocument.id,
  });
});

test("DELETE /containers/:id deletes an empty metadata folder and tears down its metadata document", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const containerId = crypto.randomUUID();
  const containerRequest = await buildCreateRequest({
    containerId,
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const metadataDocumentRequest = await buildMetadataDocumentCreateRequest({
    containerId,
    containerRequest,
    parent: root.bundle,
    signer: owner,
  });
  // A plain user folder (no systemSlot): system containers cannot be deleted.
  const created = await postJson({
    path: "/containers/with-metadata-document",
    request: {
      container: containerRequest,
      metadataDocument: metadataDocumentRequest,
    },
    token: owner.token,
  });
  expect(created.status).toBe(200);
  const metadataDocumentId = (
    containerRequest.body as { readonly metadataDocumentId: string }
  ).metadataDocumentId;

  // The folder's OWN metadata document must not block deletion of the
  // otherwise-empty folder. Regression: this returned 409 "Container has linked
  // documents" because the metadata-document link was counted as user content.
  const deleteResponse = await deleteContainerForUser({
    containerId,
    token: owner.token,
  });
  expect(deleteResponse.status).toBe(200);
  expect(isContainerDeleteResponse(await deleteResponse.json())).toBe(true);
  await grants.expectLatestChange(
    asVerifiedContainerManifest(root.bundle).state.organizationId,
  );

  // The container and every trace of its metadata document are gone (no orphan).
  expect(
    await db
      .select({ id: containers.id })
      .from(containers)
      .where(eq(containers.id, containerId)),
  ).toEqual([]);
  expect(
    await db
      .select({ documentId: containerMetadataDocuments.documentId })
      .from(containerMetadataDocuments)
      .where(eq(containerMetadataDocuments.containerId, containerId)),
  ).toEqual([]);
  expect(
    await db
      .select({ documentId: documentContainerLinks.documentId })
      .from(documentContainerLinks)
      .where(eq(documentContainerLinks.documentId, metadataDocumentId)),
  ).toEqual([]);
  expect(
    await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, metadataDocumentId)),
  ).toEqual([]);
});

test("DELETE /containers/:id still rejects a metadata folder holding a user document", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const containerId = crypto.randomUUID();
  const containerRequest = await buildCreateRequest({
    containerId,
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const metadataDocumentRequest = await buildMetadataDocumentCreateRequest({
    containerId,
    containerRequest,
    parent: root.bundle,
    signer: owner,
  });
  const created = await postJson({
    path: "/containers/with-metadata-document",
    request: {
      container: containerRequest,
      metadataDocument: metadataDocumentRequest,
    },
    token: owner.token,
  });
  expect(created.status).toBe(200);

  // A real user document linked into the folder must still block deletion — the
  // metadata-document exclusion must not weaken the guard for actual content.
  const userDocumentId = crypto.randomUUID();
  await db.insert(documents).values({
    id: userDocumentId,
    createdByFingerprint: owner.fingerprint,
  });
  await db.insert(documentContainerLinks).values({
    containerId,
    documentId: userDocumentId,
  });

  const blocked = await deleteContainerForUser({
    containerId,
    token: owner.token,
  });
  expect(blocked.status).toBe(409);
  await expect(blocked.json()).resolves.toEqual({
    error: "Container has linked documents",
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
  await joinOrg(created.organizationId, owner, recipient);
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
  const grantDelta = await grants.trackDelta(
    created.organizationId,
    owner.token,
  );
  const shared = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request,
      token: owner.token,
    }),
  );
  await grantDelta.expectReplacement(created.containerId);

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

test("POST /containers/:containerId/share rejects a group grant absent from its signed index", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const rootManifest = asVerifiedContainerManifest(root.bundle);
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    principalId: crypto.randomUUID(),
  });
  const request = await buildGroupGrantRequest({
    parentKekState: null,
    previous: root.bundle,
    previousContainerPath: [root.bundle],
    previousKekState: root.kekState,
    principalPolicy: group.policy,
    principalReference: group.reference,
    signer: owner,
  });

  const response = await postMutation({
    path: `/containers/${rootManifest.state.containerId}/share`,
    request,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error:
      "Group grant changes require a matching signed principal grant index",
  });
});

test("POST /containers/:containerId/share allows additional root group grants", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);

  const root = await bootstrapRoot(owner);
  const rootManifest = asVerifiedContainerManifest(root.bundle);
  const groupPrincipalId = crypto.randomUUID();
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    principalId: groupPrincipalId,
  });
  const granted = await commitGroupGrant({
    accessLevel: "write",
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        accessLevel: "write",
        parentKekState: null,
        previous: root.bundle,
        previousContainerPath: [root.bundle],
        previousKekState: root.kekState,
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
      }),
    containerId: rootManifest.state.containerId,
    current: group,
  });
  const shared = firstCompoundMutation(granted);

  const sharedManifest = asVerifiedContainerManifest(
    accessManifestFromResponse(shared),
  );
  expect(shared.manifestHead.epoch).toBe(rootManifest.state.epoch + 1);
  expect(sharedManifest.state.directGrants).toContainEqual({
    accessLevel: "write",
    subjectId: groupPrincipalId,
    subjectType: "group",
  });
  expect(shared.containerKek.recipientTargets).toContainEqual({
    recipientKind: "group",
    recipientId: groupPrincipalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(granted.reference),
    recipientKeyFingerprint: granted.reference.keyFingerprint,
  });
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
  const granted = await commitGroupGrant({
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        containerManifestHistory: [createdBundle, userSharedBundle],
        parentKekState: root.kekState,
        previous: userSharedBundle,
        previousContainerPath: [root.bundle, userSharedBundle],
        previousKekState: kekStateFromResponse(sharedToUser),
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
        userRecipientKeys: [recipientKey],
      }),
    containerId: created.containerId,
    current: group,
  });
  const sharedToGroup = firstCompoundMutation(granted);

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
  const grantedGroup = await commitGroupGrant({
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        containerManifestHistory: [createdBundle, userSharedBundle],
        parentKekState: root.kekState,
        previous: userSharedBundle,
        previousContainerPath: [root.bundle, userSharedBundle],
        previousKekState: kekStateFromResponse(userShared),
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
        userRecipientKeys: [directRecipientKey],
      }),
    containerId: created.containerId,
    current: initialGroup,
  });
  const shared = firstCompoundMutation(grantedGroup);

  expect(shared.containerKek.containerKeyEpochId).toBe(
    userShared.containerKek.containerKeyEpochId,
  );
  expect(shared.referencedPrincipalHeads).toEqual([
    {
      principalType: "group",
      principalId: groupPrincipalId,
      version: grantedGroup.reference.version,
      keyEpoch: grantedGroup.reference.keyEpoch,
      stateHash: grantedGroup.reference.stateHash,
      keyFingerprint: grantedGroup.reference.keyFingerprint,
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
        grantedGroup.reference,
      ),
      recipientKeyFingerprint: grantedGroup.reference.keyFingerprint,
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
  const secondGrantedGroup = await commitGroupGrant({
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        containerManifestHistory: [
          createdBundle,
          userSharedBundle,
          sharedBundle,
        ],
        parentKekState: root.kekState,
        previous: sharedBundle,
        previousContainerPath: [root.bundle, sharedBundle],
        previousKekState: kekStateFromResponse(shared),
        principalPolicies: [grantedGroup.policy],
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
        userRecipientKeys: [directRecipientKey],
      }),
    containerId: created.containerId,
    current: secondGroup,
    signedAt: "2026-04-30T00:00:31.000Z",
  });
  const secondGroupShared = firstCompoundMutation(secondGrantedGroup);
  expect(secondGroupShared.containerKek.containerKeyEpochId).toBe(
    shared.containerKek.containerKeyEpochId,
  );
  expect(secondGroupShared.containerKek.recipientTargets).toHaveLength(4);
  expect(secondGroupShared.containerKek.recipientTargets).toContainEqual({
    recipientKind: "group",
    recipientId: groupPrincipalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
      grantedGroup.reference,
    ),
    recipientKeyFingerprint: grantedGroup.reference.keyFingerprint,
  });
  expect(secondGroupShared.containerKek.recipientTargets).toContainEqual({
    recipientKind: "group",
    recipientId: secondGroupPrincipalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
      secondGrantedGroup.reference,
    ),
    recipientKeyFingerprint: secondGrantedGroup.reference.keyFingerprint,
  });

  await putGroupPrincipalPolicy({
    actor: owner,
    keyEpoch: grantedGroup.policy.keyEpoch + 1,
    prevStateHash: grantedGroup.stateHash,
    principalId: groupPrincipalId,
    principalKem: generateKemSeedAndKeyPair(),
    prepareContainerMutations: async ({ policy }) => [
      await buildRekeyRequest({
        parentKekState: root.kekState,
        previous: accessManifestFromResponse(secondGroupShared),
        previousContainerPath: [
          root.bundle,
          accessManifestFromResponse(secondGroupShared),
        ],
        previousKekState: kekStateFromResponse(secondGroupShared),
        replacementPrincipalPolicy: policy,
        signer: owner,
      }),
    ],
    signedAt: "2026-04-30T00:01:00.000Z",
    version: grantedGroup.policy.version + 1,
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
  expect((await staleResponse.json()).error).toBe("Principal policy is stale");
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
  const recipientBaselineResponse = await listRootContainers({
    token: recipient.token,
  });
  expect(recipientBaselineResponse.status).toBe(200);
  const recipientBaseline = await readLanePage(recipientBaselineResponse);
  expect(
    recipientBaseline.items.map((container: { id: string }) => container.id),
  ).toContain(created.containerId);
  expect(recipientBaseline.nextWatermark).toEqual({
    id: created.containerId,
    updatedAt: expect.any(String),
  });

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

  const recipientDeltaResponse = await listRootContainers({
    token: recipient.token,
    watermark: recipientBaseline.nextWatermark,
  });
  expect(recipientDeltaResponse.status).toBe(200);
  const recipientDelta = await readLanePage(recipientDeltaResponse);
  expect(
    recipientDelta.items.map((container: { id: string }) => container.id),
  ).not.toContain(created.containerId);
  expect(recipientDelta.tombstones).toEqual([
    {
      containerId: created.containerId,
      depth: 1,
      parentId: root.kekState.containerId,
      reason: "access_revoked",
      updatedAt: expect.any(String),
    },
  ]);
  expect(recipientDelta.nextWatermark).toEqual({
    id: created.containerId,
    updatedAt: firstTombstone(recipientDelta).updatedAt,
  });

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

test("Admins rotation rekeys its built-in grant without changing access", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const rootManifest = asVerifiedContainerManifest(root.bundle);
  const adminGrant = rootManifest.state.directGrants.find(
    (grant) => grant.subjectType === "group" && grant.accessLevel === "admin",
  );
  invariant(adminGrant, "expected root admin group grant");
  const adminPolicy = root.principalPolicies?.find(
    (policy) =>
      policy.principalType === adminGrant.subjectType &&
      policy.principalId === adminGrant.subjectId,
  );
  invariant(adminPolicy, "expected root admin group policy");
  const rotatedAdminGroup = await putGroupPrincipalPolicy({
    actor: owner,
    keyEpoch: adminPolicy.keyEpoch + 1,
    prevStateHash: adminPolicy.stateHash,
    principalId: adminPolicy.principalId,
    principalKem: generateKemSeedAndKeyPair(),
    prepareContainerMutations: async ({ policy }) => [
      (
        await buildRootContainerRekeyMutation({
          previous: root,
          replacementPrincipalPolicy: policy,
          signer: owner,
        })
      ).request,
    ],
    signedAt: "2026-04-30T00:00:30.000Z",
    version: adminPolicy.version + 1,
  });
  const reshared = await bootstrapRoot(owner);
  const resharedManifest = asVerifiedContainerManifest(reshared.bundle);

  expect(resharedManifest.state.directGrants).toContainEqual(adminGrant);
  expect(resharedManifest.state.referencedPrincipalHeads).toEqual([
    rotatedAdminGroup.reference,
  ]);
  expect(reshared.kekState.containerKeyEpochId).not.toBe(
    root.kekState.containerKeyEpochId,
  );
  expect(reshared.kekState.recipientTargets).toEqual([
    {
      recipientKind: "group",
      recipientId: adminGrant.subjectId,
      recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
        rotatedAdminGroup.reference,
      ),
      recipientKeyFingerprint: rotatedAdminGroup.reference.keyFingerprint,
    },
  ]);
});

for (const accessLevel of ["read", "write"] as const) {
  test(`POST /containers/:containerId/share rejects changing a built-in admin grant to ${accessLevel}`, async () => {
    const owner = createTestUser();
    await registerAndAuthenticate(owner);
    const root = await bootstrapRoot(owner);
    const rootManifest = asVerifiedContainerManifest(root.bundle);
    const adminGrant = rootManifest.state.directGrants.find(
      (grant) => grant.subjectType === "group" && grant.accessLevel === "admin",
    );
    invariant(adminGrant, "expected root admin group grant");
    const adminReference = rootManifest.state.referencedPrincipalHeads.find(
      (reference) =>
        reference.principalType === adminGrant.subjectType &&
        reference.principalId === adminGrant.subjectId,
    );
    invariant(adminReference, "expected root admin group reference");
    const adminPolicy = root.principalPolicies?.find(
      (policy) =>
        policy.principalType === adminGrant.subjectType &&
        policy.principalId === adminGrant.subjectId,
    );
    invariant(adminPolicy, "expected root admin group policy");
    const request = await buildGroupGrantRequest({
      accessLevel,
      parentKekState: null,
      previous: root.bundle,
      previousContainerPath: [root.bundle],
      previousKekState: root.kekState,
      principalPolicy: adminPolicy,
      principalReference: adminReference,
      signer: owner,
    });

    const response = await postMutation({
      path: `/containers/${rootManifest.state.containerId}/share`,
      request,
      token: owner.token,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "Group grant changes require a matching signed principal grant index",
    });
  });
}

test("POST /containers/:containerId/revoke rejects built-in grants", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const rootManifest = asVerifiedContainerManifest(root.bundle);
  const adminGrant = rootManifest.state.directGrants.find(
    (grant) => grant.subjectType === "group" && grant.accessLevel === "admin",
  );
  invariant(adminGrant, "expected root admin group grant");
  const revokeRequest = await buildRevokeRequest({
    parentKekState: null,
    previous: root.bundle,
    previousContainerPath: [root.bundle],
    previousKekState: root.kekState,
    revokedGrant: {
      subjectId: adminGrant.subjectId,
      subjectType: adminGrant.subjectType,
    },
    signer: owner,
  });

  const response = await postMutation({
    path: `/containers/${rootManifest.state.containerId}/revoke`,
    request: revokeRequest,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Group grants must be revoked atomically with principal rotation",
  });
});

test("group grant revoke requires and commits with principal rotation", async () => {
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
  const groupPrincipalId = crypto.randomUUID();
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    members: [{ userId: recipient.userId }],
    principalId: groupPrincipalId,
  });
  const grantedGroup = await commitGroupGrant({
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        parentKekState: root.kekState,
        previous: createdBundle,
        previousContainerPath: [root.bundle, createdBundle],
        previousKekState: kekStateFromResponse(created),
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
      }),
    containerId: created.containerId,
    current: group,
  });
  const shared = firstCompoundMutation(grantedGroup);

  const recipientBaselineResponse = await listRootContainers({
    token: recipient.token,
  });
  expect(recipientBaselineResponse.status).toBe(200);
  const recipientBaseline = await readLanePage(recipientBaselineResponse);
  expect(
    recipientBaseline.items.map((container: { id: string }) => container.id),
  ).toContain(created.containerId);
  expect(recipientBaseline.nextWatermark).toEqual({
    id: created.containerId,
    updatedAt: expect.any(String),
  });

  const sharedBundle = accessManifestFromResponse(shared);
  const revokeRequest = await buildRevokeRequest({
    parentKekState: root.kekState,
    previous: sharedBundle,
    previousContainerPath: [root.bundle, sharedBundle],
    previousKekState: kekStateFromResponse(shared),
    revokedGrant: {
      subjectType: "group",
      subjectId: groupPrincipalId,
    },
    signer: owner,
  });

  const response = await postMutation({
    path: `/containers/${created.containerId}/revoke`,
    request: revokeRequest,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Group grants must be revoked atomically with principal rotation",
  });

  revokeRequest.principalPolicies = (
    revokeRequest.principalPolicies ?? []
  ).filter((policy) => Reflect.get(policy, "principalId") !== groupPrincipalId);
  await putGroupPrincipalPolicy({
    actor: owner,
    containerMutations: [revokeRequest],
    grants: [],
    keyEpoch: grantedGroup.policy.keyEpoch + 1,
    members: grantedGroup.policy.projection.map((member) => ({
      userId: member.userId,
    })),
    prevStateHash: grantedGroup.policy.stateHash,
    principalId: groupPrincipalId,
    projection: [...grantedGroup.policy.projection],
    version: grantedGroup.policy.version + 1,
  });

  const recipientDeltaResponse = await listRootContainers({
    token: recipient.token,
    watermark: recipientBaseline.nextWatermark,
  });
  expect(recipientDeltaResponse.status).toBe(200);
  const recipientDelta = await readLanePage(recipientDeltaResponse);
  expect(
    recipientDelta.items.map((container: { id: string }) => container.id),
  ).not.toContain(created.containerId);
  expect(recipientDelta.tombstones).toEqual([
    {
      containerId: created.containerId,
      depth: 1,
      parentId: root.kekState.containerId,
      reason: "access_revoked",
      updatedAt: expect.any(String),
    },
  ]);
});

test("PUT /principals/group/:principalId/policy emits tombstones for removed group members", async () => {
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
  const groupPrincipalId = crypto.randomUUID();
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    members: [{ userId: recipient.userId }],
    principalId: groupPrincipalId,
  });
  const grantedGroup = await commitGroupGrant({
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        parentKekState: root.kekState,
        previous: createdBundle,
        previousContainerPath: [root.bundle, createdBundle],
        previousKekState: kekStateFromResponse(created),
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
      }),
    containerId: created.containerId,
    current: group,
  });
  const shared = firstCompoundMutation(grantedGroup);

  const recipientBaselineResponse = await listRootContainers({
    token: recipient.token,
  });
  expect(recipientBaselineResponse.status).toBe(200);
  const recipientBaseline = await readLanePage(recipientBaselineResponse);
  expect(
    recipientBaseline.items.map((container: { id: string }) => container.id),
  ).toContain(created.containerId);
  expect(recipientBaseline.nextWatermark).toEqual({
    id: created.containerId,
    updatedAt: expect.any(String),
  });

  await putGroupPrincipalPolicy({
    actor: owner,
    keyEpoch: grantedGroup.policy.keyEpoch + 1,
    members: [{ userId: owner.userId }],
    prevStateHash: grantedGroup.stateHash,
    principalId: groupPrincipalId,
    principalKem: generateKemSeedAndKeyPair(),
    prepareContainerMutations: async ({ policy }) => [
      await buildRekeyRequest({
        parentKekState: root.kekState,
        previous: accessManifestFromResponse(shared),
        previousContainerPath: [
          root.bundle,
          accessManifestFromResponse(shared),
        ],
        previousKekState: kekStateFromResponse(shared),
        replacementPrincipalPolicy: policy,
        signer: owner,
      }),
    ],
    signedAt: "2026-04-30T00:02:00.000Z",
    version: grantedGroup.policy.version + 1,
  });

  const recipientDeltaResponse = await listRootContainers({
    token: recipient.token,
    watermark: recipientBaseline.nextWatermark,
  });
  expect(recipientDeltaResponse.status).toBe(200);
  const recipientDelta = await readLanePage(recipientDeltaResponse);
  expect(
    recipientDelta.items.map((container: { id: string }) => container.id),
  ).not.toContain(created.containerId);
  expect(recipientDelta.tombstones).toEqual([
    {
      containerId: created.containerId,
      depth: 1,
      parentId: root.kekState.containerId,
      reason: "access_revoked",
      updatedAt: expect.any(String),
    },
  ]);
  expect(recipientDelta.nextWatermark).toEqual({
    id: created.containerId,
    updatedAt: firstTombstone(recipientDelta).updatedAt,
  });

  const recipientParentLaneResponse = await listContainersForUser({
    parentId: root.kekState.containerId,
    token: recipient.token,
  });
  expect(recipientParentLaneResponse.status).toBe(200);
  expect(
    (await readLanePage(recipientParentLaneResponse)).tombstones,
  ).toContainEqual({
    containerId: created.containerId,
    depth: 1,
    parentId: root.kekState.containerId,
    reason: "access_revoked",
    updatedAt: firstTombstone(recipientDelta).updatedAt,
  });
});

test("PUT /principals/group/:principalId/policy skips tombstones while direct access remains", async () => {
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
  const directShareRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: createdBundle,
    previousContainerPath: [root.bundle, createdBundle],
    previousKekState: kekStateFromResponse(created),
    recipient,
    signer: owner,
  });
  const directShared = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request: directShareRequest,
      token: owner.token,
    }),
  );
  const recipientKey = await userRecipientKey(recipient);
  const groupPrincipalId = crypto.randomUUID();
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    members: [{ userId: recipient.userId }],
    principalId: groupPrincipalId,
  });
  const directSharedBundle = accessManifestFromResponse(directShared);
  const grantedGroup = await commitGroupGrant({
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        containerManifestHistory: [createdBundle, directSharedBundle],
        parentKekState: root.kekState,
        previous: directSharedBundle,
        previousContainerPath: [root.bundle, directSharedBundle],
        previousKekState: kekStateFromResponse(directShared),
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
        userRecipientKeys: [recipientKey],
      }),
    containerId: created.containerId,
    current: group,
  });
  const groupShared = firstCompoundMutation(grantedGroup);

  const recipientBaselineResponse = await listRootContainers({
    token: recipient.token,
  });
  expect(recipientBaselineResponse.status).toBe(200);
  const recipientBaseline = await readLanePage(recipientBaselineResponse);
  expect(
    recipientBaseline.items.map((container: { id: string }) => container.id),
  ).toContain(created.containerId);
  expect(recipientBaseline.nextWatermark).toEqual({
    id: created.containerId,
    updatedAt: expect.any(String),
  });

  await putGroupPrincipalPolicy({
    actor: owner,
    keyEpoch: grantedGroup.policy.keyEpoch + 1,
    members: [{ userId: owner.userId }],
    prevStateHash: grantedGroup.stateHash,
    principalId: groupPrincipalId,
    principalKem: generateKemSeedAndKeyPair(),
    prepareContainerMutations: async ({ policy }) => [
      await buildRekeyRequest({
        parentKekState: root.kekState,
        previous: accessManifestFromResponse(groupShared),
        previousContainerPath: [
          root.bundle,
          accessManifestFromResponse(groupShared),
        ],
        previousKekState: kekStateFromResponse(groupShared),
        replacementPrincipalPolicy: policy,
        signer: owner,
      }),
    ],
    signedAt: "2026-04-30T00:03:00.000Z",
    version: grantedGroup.policy.version + 1,
  });

  const recipientDeltaResponse = await listRootContainers({
    token: recipient.token,
    watermark: recipientBaseline.nextWatermark,
  });
  expect(recipientDeltaResponse.status).toBe(200);
  const recipientDelta = await readLanePage(recipientDeltaResponse);
  expect(recipientDelta.tombstones).toEqual([]);
  expect(
    recipientDelta.items.map((container: { id: string }) => container.id),
  ).toContain(created.containerId);
  expect(recipientDelta.nextWatermark).toEqual({
    id: created.containerId,
    updatedAt: expect.any(String),
  });
  expect(recipientDelta.nextWatermark).not.toEqual(
    recipientBaseline.nextWatermark,
  );
});

test("POST /containers/:containerId/revoke skips tombstones while access remains inherited", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const child = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childShareRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromResponse(child),
    previousContainerPath: [root.bundle, accessManifestFromResponse(child)],
    previousKekState: kekStateFromResponse(child),
    recipient,
    signer: owner,
  });
  const sharedChild = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${child.containerId}/share`,
      request: childShareRequest,
      token: owner.token,
    }),
  );
  const sharedChildBundle = accessManifestFromResponse(sharedChild);
  const sharedChildKekState = kekStateFromResponse(sharedChild);
  const grandchild = await createChild({
    parent: sharedChildBundle,
    parentContainerPath: [root.bundle, sharedChildBundle],
    parentKekState: sharedChildKekState,
    signer: owner,
  });
  const grandchildShareRequest = await buildGrantRequest({
    parentKekState: sharedChildKekState,
    previous: accessManifestFromResponse(grandchild),
    previousContainerPath: [
      root.bundle,
      sharedChildBundle,
      accessManifestFromResponse(grandchild),
    ],
    previousKekState: kekStateFromResponse(grandchild),
    recipient,
    signer: owner,
  });
  const sharedGrandchild = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${grandchild.containerId}/share`,
      request: grandchildShareRequest,
      token: owner.token,
    }),
  );

  const recipientBaselineResponse = await listRootContainers({
    token: recipient.token,
  });
  expect(recipientBaselineResponse.status).toBe(200);
  const recipientBaseline = await readLanePage(recipientBaselineResponse);
  expect(
    recipientBaseline.items.map((container: { id: string }) => container.id),
  ).toEqual(
    expect.arrayContaining([child.containerId, grandchild.containerId]),
  );
  expect(recipientBaseline.nextWatermark).not.toBeNull();

  const sharedGrandchildBundle = accessManifestFromResponse(sharedGrandchild);
  const revokeRequest = await buildRevokeRequest({
    parentKekState: sharedChildKekState,
    previous: sharedGrandchildBundle,
    previousContainerPath: [
      root.bundle,
      sharedChildBundle,
      sharedGrandchildBundle,
    ],
    previousKekState: kekStateFromResponse(sharedGrandchild),
    revokedUser: recipient,
    signer: owner,
  });

  await expectMutationSuccess(
    await postMutation({
      path: `/containers/${grandchild.containerId}/revoke`,
      request: revokeRequest,
      token: owner.token,
    }),
  );

  const recipientRootDeltaResponse = await listRootContainers({
    token: recipient.token,
    watermark: recipientBaseline.nextWatermark,
  });
  expect(recipientRootDeltaResponse.status).toBe(200);
  const recipientRootDelta = await readLanePage(recipientRootDeltaResponse);
  expect(recipientRootDelta.tombstones).toEqual([]);
  expect(recipientRootDelta.nextWatermark).toEqual(
    recipientBaseline.nextWatermark,
  );

  const recipientChildLaneResponse = await listContainersForUser({
    parentId: child.containerId,
    token: recipient.token,
  });
  expect(recipientChildLaneResponse.status).toBe(200);
  const recipientChildLane = await readLanePage(recipientChildLaneResponse);
  expect(
    recipientChildLane.items.map((container: { id: string }) => container.id),
  ).toContain(grandchild.containerId);
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
  expect(rekeyed.containerKek.keyring).toEqual(
    request.keyring as ContainerMutationResponse["containerKek"]["keyring"],
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

test("POST /containers/:containerId/rekey rejects recipient-set changes", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childBundle = accessManifestFromResponse(created);
  const request = await buildRekeyRequest({
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: kekStateFromResponse(created),
    signer: owner,
  });
  const previous = asVerifiedContainerManifest(childBundle);
  const event = request.event as unknown as AccessEvent;
  const body = request.body as { readonly containerKeyEpochId: string };
  const tamperedManifestState: ContainerAccessManifestState = {
    ...previous.state,
    epoch: previous.state.epoch + 1,
    previousManifestHash: childBundle.manifestHash,
    eventHash: await computeAccessEventHash(event),
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: [
      ...previous.state.directGrants,
      {
        accessLevel: "read",
        subjectId: owner.userId,
        subjectType: "user",
      },
    ],
  };
  const tamperedManifest = await deriveContainerAccessManifest(
    tamperedManifestState,
  );
  request.manifest = tamperedManifest as unknown as Record<string, unknown>;
  request.expectedManifestHash =
    await computeAccessManifestHash(tamperedManifest);

  const response = await postMutation({
    path: `/containers/${created.containerId}/rekey`,
    request,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "container access manifest hash does not match derived state",
  });
});

test("POST /containers/:containerId/rekey rejects KEK wraps outside the verified target set", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childBundle = accessManifestFromResponse(created);
  const request = await buildRekeyRequest({
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: kekStateFromResponse(created),
    signer: owner,
  });
  const ownerRecipientKey = await userRecipientKey(owner);
  const keyEpoch = request.keyEpoch as unknown as ContainerKeyEpoch;
  request.wraps = [
    ...request.wraps,
    createContainerKeyWrap({
      containerKeyEpochId: keyEpoch.id,
      recipientKind: "user",
      recipientId: ownerRecipientKey.userId,
      recipientKeyEpochId: ownerRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: ownerRecipientKey.recipientKeyFingerprint,
      wrapManifestHash: request.expectedManifestHash,
    }) as unknown as Record<string, unknown>,
  ];

  const response = await postMutation({
    path: `/containers/${created.containerId}/rekey`,
    request,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "container key wrap is not justified by its manifest",
  });
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
  const sourceBundle = accessManifestFromResponse(source);
  const sourceKekState = kekStateFromResponse(source);
  const grandchild = await createChild({
    parent: sourceBundle,
    parentContainerPath: [root.bundle, sourceBundle],
    parentKekState: sourceKekState,
    signer: owner,
  });
  const destination = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const preMoveUpdatedAt = new Date("2026-05-05T00:00:00.000Z");
  await db
    .update(containers)
    .set({ updatedAt: preMoveUpdatedAt })
    .where(
      inArray(containers.id, [source.containerId, grandchild.containerId]),
    );

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
    previous: sourceBundle,
    previousContainerPath: [root.bundle, sourceBundle],
    previousKekState: sourceKekState,
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
    previous: sourceBundle,
    previousContainerPath: [root.bundle, sourceBundle],
    previousKekState: sourceKekState,
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

  const movedRows = await db
    .select({
      depth: containers.depth,
      id: containers.id,
      parentId: containers.parentId,
      updatedAt: containers.updatedAt,
    })
    .from(containers)
    .where(
      inArray(containers.id, [
        destination.containerId,
        source.containerId,
        grandchild.containerId,
      ]),
    );
  const movedRowsById = new Map(movedRows.map((row) => [row.id, row]));
  expect(movedRowsById.get(destination.containerId)).toMatchObject({
    depth: 1,
    parentId: root.kekState.containerId,
  });
  expect(movedRowsById.get(source.containerId)).toMatchObject({
    depth: 2,
    parentId: destination.containerId,
  });
  expect(movedRowsById.get(grandchild.containerId)).toMatchObject({
    depth: 3,
    parentId: source.containerId,
  });

  const movedSourceUpdatedAt = movedRowsById
    .get(source.containerId)
    ?.updatedAt.toISOString();
  const movedGrandchildUpdatedAt = movedRowsById
    .get(grandchild.containerId)
    ?.updatedAt.toISOString();
  expect(movedSourceUpdatedAt).toBe(movedGrandchildUpdatedAt);
  expect(movedSourceUpdatedAt).not.toBe(preMoveUpdatedAt.toISOString());
});

test("POST /containers/:containerId/move relocates a folder into a system (Trash) container and back out", async () => {
  // The client "Move to Trash" folder action is a container move whose
  // destination is the Trash system container. The move workflow only guards the
  // MOVED container's system slot (a system container itself cannot be moved); it
  // deliberately does NOT guard the destination's slot, so a normal folder can be
  // re-parented under Trash. This locks that in — a destination-slot guard would
  // silently break folder trashing — and confirms the round trip (restore) works.
  const owner = createTestUser();
  await registerAndAuthenticate(owner);

  const root = await bootstrapRoot(owner);
  const trash = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  // Stamp the destination as a system container. The slot is a server-opaque
  // column, not part of the signed manifest, so the move request built against
  // trash's manifest stays valid.
  const trashSystemSlot = "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await db
    .update(containers)
    .set({ systemSlot: trashSystemSlot })
    .where(eq(containers.id, trash.containerId));
  const folder = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const restoreTarget = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  const trashBundle = accessManifestFromResponse(trash);
  const trashKekState = kekStateFromResponse(trash);

  const moveIntoTrash = await buildMoveRequest({
    destinationParent: trashBundle,
    destinationParentKekState: trashKekState,
    destinationParentPath: [root.bundle, trashBundle],
    previous: accessManifestFromResponse(folder),
    previousContainerPath: [root.bundle, accessManifestFromResponse(folder)],
    previousKekState: kekStateFromResponse(folder),
    signer: owner,
  });
  const trashed = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${folder.containerId}/move`,
      request: moveIntoTrash,
      token: owner.token,
    }),
  );
  expect(trashed.parentId).toBe(trash.containerId);

  const [trashedRow] = await db
    .select({ depth: containers.depth, parentId: containers.parentId })
    .from(containers)
    .where(eq(containers.id, folder.containerId));
  expect(trashedRow).toMatchObject({ depth: 2, parentId: trash.containerId });

  // Restore: move the trashed folder back out to a normal folder. Content under a
  // system container is not pinned there, so the same move endpoint pulls it back.
  const restoreTargetBundle = accessManifestFromResponse(restoreTarget);
  const restoreOut = await buildMoveRequest({
    destinationParent: restoreTargetBundle,
    destinationParentKekState: kekStateFromResponse(restoreTarget),
    destinationParentPath: [root.bundle, restoreTargetBundle],
    previous: accessManifestFromResponse(trashed),
    previousContainerPath: [
      root.bundle,
      trashBundle,
      accessManifestFromResponse(trashed),
    ],
    previousKekState: kekStateFromResponse(trashed),
    signer: owner,
  });
  const restored = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${folder.containerId}/move`,
      request: restoreOut,
      token: owner.token,
    }),
  );
  expect(restored.parentId).toBe(restoreTarget.containerId);
});

test("POST /containers/:containerId/move emits tombstones when inherited access is lost", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const oldParent = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const oldParentShareRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromResponse(oldParent),
    previousContainerPath: [root.bundle, accessManifestFromResponse(oldParent)],
    previousKekState: kekStateFromResponse(oldParent),
    recipient,
    signer: owner,
  });
  const sharedOldParent = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${oldParent.containerId}/share`,
      request: oldParentShareRequest,
      token: owner.token,
    }),
  );
  const sharedOldParentBundle = accessManifestFromResponse(sharedOldParent);
  const sharedOldParentKekState = kekStateFromResponse(sharedOldParent);
  const source = await createChild({
    parent: sharedOldParentBundle,
    parentContainerPath: [root.bundle, sharedOldParentBundle],
    parentKekState: sharedOldParentKekState,
    signer: owner,
  });
  const destination = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });

  const recipientBaselineResponse = await listContainersForUser({
    parentId: oldParent.containerId,
    token: recipient.token,
  });
  expect(recipientBaselineResponse.status).toBe(200);
  const recipientBaseline = await readLanePage(recipientBaselineResponse);
  expect(
    recipientBaseline.items.map((container: { id: string }) => container.id),
  ).toContain(source.containerId);
  expect(recipientBaseline.nextWatermark).toEqual({
    id: source.containerId,
    updatedAt: expect.any(String),
  });

  const sourceBundle = accessManifestFromResponse(source);
  const moveRequest = await buildMoveRequest({
    destinationParent: accessManifestFromResponse(destination),
    destinationParentKekState: kekStateFromResponse(destination),
    destinationParentPath: [
      root.bundle,
      accessManifestFromResponse(destination),
    ],
    previous: sourceBundle,
    previousContainerPath: [root.bundle, sharedOldParentBundle, sourceBundle],
    previousKekState: kekStateFromResponse(source),
    signer: owner,
  });

  await expectMutationSuccess(
    await postMutation({
      path: `/containers/${source.containerId}/move`,
      request: moveRequest,
      token: owner.token,
    }),
  );

  const recipientDeltaResponse = await listContainersForUser({
    parentId: oldParent.containerId,
    token: recipient.token,
    watermark: recipientBaseline.nextWatermark,
  });
  expect(recipientDeltaResponse.status).toBe(200);
  const recipientDelta = await readLanePage(recipientDeltaResponse);
  expect(
    recipientDelta.items.map((container: { id: string }) => container.id),
  ).not.toContain(source.containerId);
  expect(recipientDelta.tombstones).toEqual([
    {
      containerId: source.containerId,
      depth: 2,
      parentId: oldParent.containerId,
      reason: "access_revoked",
      updatedAt: expect.any(String),
    },
  ]);
  expect(recipientDelta.nextWatermark).toEqual({
    id: source.containerId,
    updatedAt: firstTombstone(recipientDelta).updatedAt,
  });
});

test("DELETE /containers/:containerId removes a leaf and emits deleted tombstones", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);
  const groupMember = createTestUser();
  await registerAndAuthenticate(groupMember);

  const root = await bootstrapRoot(owner);
  const child = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childShareRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromResponse(child),
    previousContainerPath: [root.bundle, accessManifestFromResponse(child)],
    previousKekState: kekStateFromResponse(child),
    recipient,
    signer: owner,
  });
  const sharedChild = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${child.containerId}/share`,
      request: childShareRequest,
      token: owner.token,
    }),
  );

  const recipientKey = await userRecipientKey(recipient);
  const groupPrincipalId = crypto.randomUUID();
  await addOrganizationMember({
    actor: owner,
    member: groupMember,
    organizationId: await getDefaultOrganizationId(owner.userId),
  });
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    members: [{ userId: groupMember.userId }],
    principalId: groupPrincipalId,
  });
  const sharedChildBundle = accessManifestFromResponse(sharedChild);
  const grantedGroup = await commitGroupGrant({
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        containerManifestHistory: [
          accessManifestFromResponse(child),
          sharedChildBundle,
        ],
        parentKekState: root.kekState,
        previous: sharedChildBundle,
        previousContainerPath: [root.bundle, sharedChildBundle],
        previousKekState: kekStateFromResponse(sharedChild),
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
        userRecipientKeys: [recipientKey],
      }),
    containerId: child.containerId,
    current: group,
  });
  const groupSharedChild = firstCompoundMutation(grantedGroup);

  const recipientBaselineResponse = await listRootContainers({
    token: recipient.token,
  });
  expect(recipientBaselineResponse.status).toBe(200);
  const recipientBaseline = await readLanePage(recipientBaselineResponse);
  expect(
    recipientBaseline.items.map((container: { id: string }) => container.id),
  ).toContain(groupSharedChild.containerId);

  const groupMemberBaselineResponse = await listRootContainers({
    token: groupMember.token,
  });
  expect(groupMemberBaselineResponse.status).toBe(200);
  const groupMemberBaseline = await readLanePage(groupMemberBaselineResponse);
  expect(
    groupMemberBaseline.items.map((container: { id: string }) => container.id),
  ).toContain(groupSharedChild.containerId);

  const deleteResponse = await deleteContainerForUser({
    containerId: groupSharedChild.containerId,
    token: owner.token,
  });
  expect(deleteResponse.status).toBe(200);
  const deleteBody = await deleteResponse.json();
  expect(isContainerDeleteResponse(deleteBody)).toBe(true);
  expect(deleteBody).toEqual({
    containerId: groupSharedChild.containerId,
    deletedAt: expect.any(String),
  });

  const liveRows = await db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.id, groupSharedChild.containerId));
  expect(liveRows).toEqual([]);

  const tombstoneRows = await db
    .select({
      containerId: containerSyncTombstones.containerId,
      parentId: containerSyncTombstones.parentId,
      reason: containerSyncTombstones.reason,
      rootDiscoveryVisible: containerSyncTombstones.rootDiscoveryVisible,
      userId: containerSyncTombstones.userId,
    })
    .from(containerSyncTombstones)
    .where(
      eq(containerSyncTombstones.containerId, groupSharedChild.containerId),
    );
  expect(tombstoneRows).toEqual(
    expect.arrayContaining([
      {
        containerId: groupSharedChild.containerId,
        parentId: root.kekState.containerId,
        reason: "deleted",
        rootDiscoveryVisible: true,
        userId: owner.userId,
      },
      {
        containerId: groupSharedChild.containerId,
        parentId: root.kekState.containerId,
        reason: "deleted",
        rootDiscoveryVisible: true,
        userId: recipient.userId,
      },
      {
        containerId: groupSharedChild.containerId,
        parentId: root.kekState.containerId,
        reason: "deleted",
        rootDiscoveryVisible: true,
        userId: groupMember.userId,
      },
    ]),
  );

  const recipientDeltaResponse = await listRootContainers({
    token: recipient.token,
    watermark: recipientBaseline.nextWatermark,
  });
  expect(recipientDeltaResponse.status).toBe(200);
  const recipientDelta = await readLanePage(recipientDeltaResponse);
  expect(recipientDelta.items).toEqual([]);
  expect(recipientDelta.tombstones).toEqual([
    {
      containerId: groupSharedChild.containerId,
      depth: 1,
      parentId: root.kekState.containerId,
      reason: "deleted",
      updatedAt: expect.any(String),
    },
  ]);

  const groupMemberDeltaResponse = await listRootContainers({
    token: groupMember.token,
    watermark: groupMemberBaseline.nextWatermark,
  });
  expect(groupMemberDeltaResponse.status).toBe(200);
  const groupMemberDelta = await readLanePage(groupMemberDeltaResponse);
  expect(groupMemberDelta.items).toEqual([]);
  expect(groupMemberDelta.tombstones).toEqual([
    {
      containerId: groupSharedChild.containerId,
      depth: 1,
      parentId: root.kekState.containerId,
      reason: "deleted",
      updatedAt: expect.any(String),
    },
  ]);
});

test("DELETE /containers/:containerId rejects system roots, child-bearing containers, and non-admin users", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const parent = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const child = await createChild({
    parent: accessManifestFromResponse(parent),
    parentContainerPath: [root.bundle, accessManifestFromResponse(parent)],
    parentKekState: kekStateFromResponse(parent),
    signer: owner,
  });
  const childShareRequest = await buildGrantRequest({
    parentKekState: kekStateFromResponse(parent),
    previous: accessManifestFromResponse(child),
    previousContainerPath: [
      root.bundle,
      accessManifestFromResponse(parent),
      accessManifestFromResponse(child),
    ],
    previousKekState: kekStateFromResponse(child),
    recipient,
    signer: owner,
  });
  const sharedChild = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${child.containerId}/share`,
      request: childShareRequest,
      token: owner.token,
    }),
  );

  const rootContainerDelete = await deleteContainerForUser({
    containerId: root.kekState.containerId,
    token: owner.token,
  });
  expect(rootContainerDelete.status).toBe(400);
  await expect(rootContainerDelete.json()).resolves.toEqual({
    error: "Root container cannot be deleted",
  });

  const builtinContacts = await createChild({
    parent: root.bundle,
    parentContainerPath: [root.bundle],
    parentKekState: root.kekState,
    signer: owner,
  });
  await db
    .update(containers)
    .set({ systemSlot: TEST_CONTACTS_SYSTEM_SLOT })
    .where(eq(containers.id, builtinContacts.containerId));
  const builtinContactsDelete = await deleteContainerForUser({
    containerId: builtinContacts.containerId,
    token: owner.token,
  });
  expect(builtinContactsDelete.status).toBe(400);
  await expect(builtinContactsDelete.json()).resolves.toEqual({
    error: "System container cannot be deleted",
  });

  const parentDelete = await deleteContainerForUser({
    containerId: parent.containerId,
    token: owner.token,
  });
  expect(parentDelete.status).toBe(409);

  const linkedDocumentId = crypto.randomUUID();
  await db.insert(documents).values({
    id: linkedDocumentId,
    createdByFingerprint: owner.fingerprint,
  });
  await db.insert(documentContainerLinks).values({
    containerId: child.containerId,
    documentId: linkedDocumentId,
  });
  const documentBearingDelete = await deleteContainerForUser({
    containerId: child.containerId,
    token: owner.token,
  });
  expect(documentBearingDelete.status).toBe(409);
  await expect(documentBearingDelete.json()).resolves.toEqual({
    error: "Container has linked documents",
  });

  const recipientDelete = await deleteContainerForUser({
    containerId: sharedChild.containerId,
    token: recipient.token,
  });
  expect(recipientDelete.status).toBe(403);

  const liveRows = await db
    .select({ id: containers.id })
    .from(containers)
    .where(inArray(containers.id, [parent.containerId, child.containerId]));
  expect(liveRows.map((row) => row.id).sort()).toEqual(
    [parent.containerId, child.containerId].sort(),
  );

  const tombstoneRows = await db
    .select({ containerId: containerSyncTombstones.containerId })
    .from(containerSyncTombstones)
    .where(eq(containerSyncTombstones.containerId, child.containerId));
  expect(tombstoneRows).toEqual([]);
});

test("POST /containers/:containerId/share prunes regained tombstones", async () => {
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

  // The post-revocation state: the recipient holds a stale access_revoked
  // tombstone for the child plus an undelivered one for a container they are
  // not being re-granted.
  const unrelatedContainerId = crypto.randomUUID();
  await db.insert(containerSyncTombstones).values([
    {
      containerId: created.containerId,
      depth: 1,
      organizationId: created.organizationId,
      parentId: null,
      reason: "access_revoked",
      updatedAt: new Date("2026-12-31T00:00:00.000Z"),
      userId: recipient.userId,
    },
    {
      containerId: unrelatedContainerId,
      depth: 0,
      organizationId: created.organizationId,
      parentId: null,
      reason: "access_revoked",
      updatedAt: new Date("2026-12-31T00:00:00.000Z"),
      userId: recipient.userId,
    },
  ]);

  const request = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: childKek,
    recipient,
    signer: owner,
  });
  await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request,
      token: owner.token,
    }),
  );

  const remaining = await db
    .select({ containerId: containerSyncTombstones.containerId })
    .from(containerSyncTombstones)
    .where(eq(containerSyncTombstones.userId, recipient.userId));
  expect(remaining).toEqual([{ containerId: unrelatedContainerId }]);
});

test("POST share group grant prunes member tombstones", async () => {
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
  const groupPrincipalId = crypto.randomUUID();
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    members: [{ userId: owner.userId }, { userId: recipient.userId }],
    principalId: groupPrincipalId,
  });

  // The post-revocation state: the recipient, a current member of the
  // granted group, holds a stale access_revoked tombstone for the child.
  await db.insert(containerSyncTombstones).values({
    containerId: created.containerId,
    depth: 1,
    organizationId: created.organizationId,
    parentId: null,
    reason: "access_revoked",
    updatedAt: new Date("2026-12-31T00:00:00.000Z"),
    userId: recipient.userId,
  });

  await commitGroupGrant({
    accessLevel: "read",
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        accessLevel: "read",
        parentKekState: root.kekState,
        previous: childBundle,
        previousContainerPath: [root.bundle, childBundle],
        previousKekState: childKek,
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
      }),
    containerId: created.containerId,
    current: group,
  });

  const remaining = await db
    .select({ id: containerSyncTombstones.id })
    .from(containerSyncTombstones)
    .where(eq(containerSyncTombstones.userId, recipient.userId));
  expect(remaining).toEqual([]);
});
