import {
  type EncapsulationKeyPair,
  generateKemSeedAndKeyPair,
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicyExternalAuthority,
  type PrincipalPolicySignerPublicKey,
  type ReferencedPrincipalHead,
  type SigningKeyPair,
  toFingerprint,
  unwrapDek,
  type VerifiedPrincipalPolicy,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  ContainerMutationRequest,
  CreateOrganizationGroupRequest,
  PrincipalProjectionMemberRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type {
  CurrentPrincipalMemberEnvelopesResponse,
  OrganizationGroupSummaryResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import {
  advanceKeyingCheckpointsAtomically,
  persistVerifiedPrincipalPolicyBundlesAtomically,
} from "../../data/persistence/keyingCheckpointAdvancePersistence";
import {
  persistLocallyAcknowledgedPrincipalPolicyBundle,
  retainLocallyAcknowledgedPrincipalPolicyBundle,
} from "../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import { savePrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type {
  TrustedUserIdentity,
  TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";
import {
  externalAdminPolicyPersistenceEntries,
  loadOrganizationExternalAdminPolicy,
  type VerifiedExternalAdminPolicy,
} from "../principals/externalAdminPolicy";
import {
  isDirectGroupAdmin,
  requireSignerCanManageGroup,
} from "./groupMutationAuthorization";
import {
  acknowledgeGroupPolicyState,
  acknowledgeInitialGroupPolicy,
  assertGroupPolicyBundleMatchesAcknowledgement,
  assertGroupPolicyEnvelopesMatchAcknowledgement,
  prepareAuthoredGroupPolicy,
} from "./groupPolicyMutationAcknowledgement";
import {
  assertPrincipalPolicyCurrentStateMatchesHead,
  groupPolicyMutationHead,
} from "./groupPolicyMutationHead";
import {
  collectGroupPolicySignerPublicKeys,
  prepareGroupPolicyVerification,
  verifyGroupPolicy,
  verifyGroupPolicyWithExternalOrganizationAdmins,
} from "./groupPolicyVerification";
import { hasAdmin } from "./principalPolicyProjection";
import {
  rewrapProjectionMemberEnvelopes,
  toPrincipalMemberEnvelopeRequest,
  toRecipientEntries,
} from "./principalPolicyRecipients";
import {
  buildInitialGroupPolicyRequest,
  buildInitialMemberGroupPolicyRequest,
  signedGroupPolicyRequest,
  userProjectionMember,
} from "./principalPolicyRequest";
import {
  projectionUserIds,
  resolveRequiredUserIdentities,
} from "./trustedOrganizationUsers";

export { buildInitialGroupPolicyRequest, buildInitialMemberGroupPolicyRequest };

interface OrganizationPrincipalPolicyApi {
  createOrganizationGroup: (
    organizationId: string,
    input: CreateOrganizationGroupRequest,
  ) => Promise<OrganizationGroupSummaryResponse | null>;
  getCurrentPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
  putPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
    input: PutPrincipalPolicyRequest,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
}

interface BuildGroupMembershipMutationInput {
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly currentPolicySignerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
  readonly currentOrgAdminUserIds?: readonly string[] | undefined;
  readonly externalAuthority?: PrincipalPolicyExternalAuthority | undefined;
  readonly isOrganizationAdminsGroup?: boolean | undefined;
  readonly localPolicyCheckpoint?: PrincipalPolicyCheckpoint | null;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}

type GroupPolicyMutationRequest = PutPrincipalPolicyRequest;

type BuildAddGroupUserPolicyInput = BuildGroupMembershipMutationInput & {
  readonly currentUsers: ReadonlyArray<TrustedUserIdentity>;
  readonly currentUserSecretKey: Uint8Array;
  readonly targetUser: TrustedUserIdentity;
};

interface LoadedGroupPolicyMutationContext
  extends BuildGroupMembershipMutationInput {
  readonly adminGroupId: string;
  readonly currentOrgAdminUserIds: readonly string[];
  readonly memberGroupId: string;
}

function projectionMemberKey(member: { readonly userId: string }): string {
  return member.userId;
}

function requireExternalAuthority(
  authority: PrincipalPolicyExternalAuthority | undefined,
): PrincipalPolicyExternalAuthority {
  if (!authority) {
    throw new Error("External principal authority could not be verified");
  }
  return authority;
}

async function cacheGroupPolicy(input: {
  readonly acknowledgedMemberEnvelopes?:
    | CurrentPrincipalMemberEnvelopesResponse
    | undefined;
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly externalAuthority?: PrincipalPolicyExternalAuthority | undefined;
  readonly execSql: ExecSql;
  readonly expectedCurrentHead?: ReferencedPrincipalHead | undefined;
  readonly groupId: string;
  readonly localPolicyCheckpoint?: PrincipalPolicyCheckpoint | null;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<PrincipalPolicyBundleResponse> {
  const bundle = await input.apiClient.getCurrentPrincipalPolicy(
    "group",
    input.groupId,
  );

  if (!bundle) {
    throw new Error("Updated group policy could not be loaded");
  }

  const signerPublicKeys = await collectGroupPolicySignerPublicKeys({
    bundle,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  const verified = await verifyGroupPolicy({
    currentPolicy: bundle,
    ...(input.externalAuthority
      ? { externalAuthority: input.externalAuthority }
      : {}),
    localPolicyCheckpoint: input.localPolicyCheckpoint ?? null,
    signerPublicKeys,
  });
  if (input.expectedCurrentHead) {
    assertPrincipalPolicyCurrentStateMatchesHead(
      bundle.currentState,
      input.expectedCurrentHead,
    );
  }
  if (input.acknowledgedMemberEnvelopes) {
    assertGroupPolicyEnvelopesMatchAcknowledgement(
      input.acknowledgedMemberEnvelopes,
      bundle.currentMemberEnvelopes,
    );
  }
  await advanceKeyingCheckpointsAtomically({
    access: [],
    execSql: input.execSql,
    policies: [verified],
  });
  await savePrincipalPolicyBundle(
    input.execSql,
    bundle,
    new Date().toISOString(),
  );
  return bundle;
}

async function loadGroupPolicyMutationContext(input: {
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly organizationId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<LoadedGroupPolicyMutationContext> {
  const currentPolicy = await input.apiClient.getCurrentPrincipalPolicy(
    "group",
    input.groupId,
  );

  if (!currentPolicy) {
    throw new Error("Group policy could not be loaded");
  }

  const verification = await prepareGroupPolicyVerification({
    currentPolicy,
    execSql: input.execSql,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  let externalAdminPolicy:
    | Promise<VerifiedExternalAdminPolicy | null>
    | undefined;
  const loadExternalAdminPolicy = () => {
    externalAdminPolicy ??= loadOrganizationExternalAdminPolicy({
      execSql: input.execSql,
      getCurrentPrincipalPolicy: (principalType, principalId) =>
        principalType === "group" && principalId === input.groupId
          ? Promise.resolve(currentPolicy)
          : input.apiClient.getCurrentPrincipalPolicy(
              principalType,
              principalId,
            ),
      organizationId: input.organizationId,
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    });
    return externalAdminPolicy;
  };
  const adminPolicy = await loadExternalAdminPolicy();
  if (!adminPolicy) {
    throw new Error("Organization admin authority could not be verified");
  }
  const isOrganizationAdminsGroup = adminPolicy.adminGroupId === input.groupId;
  const currentOrgAdminUserIds = adminPolicy.signerUserIds;
  const externalAuthority = adminPolicy.externalAuthority;
  if (!currentOrgAdminUserIds.includes(input.signerUserId)) {
    throw new Error("Organization admin authority is required");
  }
  const verified = isOrganizationAdminsGroup
    ? await verifyGroupPolicy({
        currentPolicy,
        localPolicyCheckpoint: verification.localPolicyCheckpoint,
        signerPublicKeys: verification.currentPolicySignerPublicKeys,
      })
    : await verifyGroupPolicyWithExternalOrganizationAdmins({
        currentPolicy,
        loadExternalAuthority: async () => externalAuthority,
        localPolicyCheckpoint: verification.localPolicyCheckpoint,
        signerPublicKeys: verification.currentPolicySignerPublicKeys,
      });
  requireSignerCanManageGroup(
    currentPolicy,
    currentOrgAdminUserIds,
    input.signerUserId,
  );
  await persistVerifiedPrincipalPolicyBundlesAtomically({
    entries: [
      ...externalAdminPolicyPersistenceEntries(adminPolicy).filter(
        (entry) =>
          entry.policy.principalType !== verified.principalType ||
          entry.policy.principalId !== verified.principalId,
      ),
      { bundle: currentPolicy, policy: verified },
    ],
    execSql: input.execSql,
    updatedAt: new Date().toISOString(),
  });

  return {
    adminGroupId: adminPolicy.adminGroupId,
    currentPolicy,
    currentOrgAdminUserIds,
    externalAuthority,
    isOrganizationAdminsGroup,
    memberGroupId: adminPolicy.memberGroupId,
    ...verification,
    localPolicyCheckpoint: verified.checkpoint,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  };
}

async function commitGroupPolicyMutation(input: {
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly execSql: ExecSql;
  readonly expectedHead: ReferencedPrincipalHead;
  readonly groupId: string;
  readonly request: GroupPolicyMutationRequest;
}): Promise<PrincipalPolicyBundleResponse> {
  const storedPolicy = await input.apiClient.putPrincipalPolicy(
    "group",
    input.groupId,
    input.request,
  );

  if (!storedPolicy) {
    throw new Error("Group policy update failed");
  }
  const acknowledgedPolicy = await acknowledgeGroupPolicyState({
    currentPolicy: input.currentPolicy,
    expectedHead: input.expectedHead,
    request: input.request,
    response: storedPolicy.currentState,
  });
  assertGroupPolicyBundleMatchesAcknowledgement({
    currentPolicy: input.currentPolicy,
    expectedHead: input.expectedHead,
    request: input.request,
    response: storedPolicy,
  });
  await retainLocallyAcknowledgedPrincipalPolicyBundle({
    bundle: storedPolicy,
    execSql: input.execSql,
    policy: acknowledgedPolicy,
    updatedAt: new Date().toISOString(),
  });
  return storedPolicy;
}

async function buildOrgAdminAddGroupUserPolicyRequest(
  input: BuildAddGroupUserPolicyInput,
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): Promise<GroupPolicyMutationRequest> {
  const groupKem = generateKemSeedAndKeyPair();
  const usersById = new Map([
    ...input.currentUsers.map((user) => [user.userId, user] as const),
    [input.targetUser.userId, input.targetUser] as const,
  ]);
  const recipientUsers = projection.map((member) => {
    const user = usersById.get(member.userId);
    if (!user) {
      throw new Error(`Missing recipient key for user ${member.userId}`);
    }

    return user;
  });
  const wrappedRecipients = await wrapDekForRecipients(
    groupKem.secretKey,
    recipientUsers.map((user) => user.encapsulationPublicKey),
  );
  const memberEnvelopes = wrappedRecipients.map((envelope, index) =>
    toPrincipalMemberEnvelopeRequest({
      envelope,
      userId: recipientUsers[index]?.userId ?? "",
    }),
  );
  return signedGroupPolicyRequest({
    currentPolicy: input.currentPolicy,
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    externalAuthority: requireExternalAuthority(input.externalAuthority)
      .currentHead,
    keyEpoch: input.currentPolicy.currentState.keyEpoch + 1,
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    memberEnvelopes,
    principalId: input.currentPolicy.currentState.principalId,
    projection,
    signedAt: new Date().toISOString(),
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
}

async function buildDirectAdminAddGroupUserPolicyRequest(
  input: BuildAddGroupUserPolicyInput,
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
  targetKey: string,
): Promise<GroupPolicyMutationRequest> {
  const groupSecretKey = await unwrapDek(
    toRecipientEntries(input.currentPolicy.currentMemberEnvelopes.envelopes),
    input.currentUserSecretKey,
  );
  const [targetEnvelope] = await wrapDekForRecipients(groupSecretKey, [
    input.targetUser.encapsulationPublicKey,
  ]);

  if (!targetEnvelope) {
    throw new Error("Failed to wrap group key for target user");
  }

  const memberEnvelopes = [
    ...input.currentPolicy.currentMemberEnvelopes.envelopes.filter(
      (envelope) => projectionMemberKey(envelope) !== targetKey,
    ),
    {
      userId: input.targetUser.userId,
      memberKeyFingerprint: input.targetUser.encapsulationKeyFingerprint,
      kemCipherText: bytesToBase64(targetEnvelope.kemCipherText),
      wrappedKey: bytesToBase64(targetEnvelope.wrappedKey),
    },
  ];
  return signedGroupPolicyRequest({
    currentPolicy: input.currentPolicy,
    encapsulationPublicKey:
      input.currentPolicy.currentState.encapsulationPublicKey,
    externalAuthority: null,
    keyEpoch: input.currentPolicy.currentState.keyEpoch,
    keyFingerprint: input.currentPolicy.currentState.keyFingerprint,
    memberEnvelopes,
    principalId: input.currentPolicy.currentState.principalId,
    projection,
    signedAt: new Date().toISOString(),
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
}

export async function buildAddGroupUserPolicyRequest(
  input: BuildAddGroupUserPolicyInput,
): Promise<GroupPolicyMutationRequest> {
  await verifyGroupPolicy({
    currentPolicy: input.currentPolicy,
    ...(input.externalAuthority
      ? { externalAuthority: input.externalAuthority }
      : {}),
    localPolicyCheckpoint: input.localPolicyCheckpoint ?? null,
    signerPublicKeys: input.currentPolicySignerPublicKeys,
  });
  requireSignerCanManageGroup(
    input.currentPolicy,
    input.currentOrgAdminUserIds ?? [],
    input.signerUserId,
  );

  const targetKey = projectionMemberKey({
    userId: input.targetUser.userId,
  });
  const currentProjection = input.currentPolicy.currentProjection;
  if (
    currentProjection.some(
      (member) => projectionMemberKey(member) === targetKey,
    )
  ) {
    throw new Error("User is already a group member");
  }

  const projection = [
    ...currentProjection,
    userProjectionMember(
      input.targetUser.userId,
      input.isOrganizationAdminsGroup ? "admin" : "member",
    ),
  ];

  return isDirectGroupAdmin(input.currentPolicy, input.signerUserId)
    ? buildDirectAdminAddGroupUserPolicyRequest(input, projection, targetKey)
    : buildOrgAdminAddGroupUserPolicyRequest(input, projection);
}

export async function buildRemoveGroupUserPolicyRequest(
  input: BuildGroupMembershipMutationInput & {
    readonly remainingUsers: ReadonlyArray<TrustedUserIdentity>;
    readonly removedUserId: string;
  },
): Promise<GroupPolicyMutationRequest> {
  await verifyGroupPolicy({
    currentPolicy: input.currentPolicy,
    ...(input.externalAuthority
      ? { externalAuthority: input.externalAuthority }
      : {}),
    localPolicyCheckpoint: input.localPolicyCheckpoint ?? null,
    signerPublicKeys: input.currentPolicySignerPublicKeys,
  });
  requireSignerCanManageGroup(
    input.currentPolicy,
    input.currentOrgAdminUserIds ?? [],
    input.signerUserId,
  );

  const key = projectionMemberKey({
    userId: input.removedUserId,
  });
  const projection = input.currentPolicy.currentProjection.filter(
    (member) => projectionMemberKey(member) !== key,
  );

  if (projection.length === input.currentPolicy.currentProjection.length) {
    throw new Error("User is not a group member");
  }

  if (!hasAdmin(projection)) {
    throw new Error("Cannot remove the last group admin");
  }

  const groupKem = generateKemSeedAndKeyPair();
  const memberEnvelopes = await rewrapProjectionMemberEnvelopes({
    projection,
    secretKey: groupKem.secretKey,
    users: input.remainingUsers,
  });
  return signedGroupPolicyRequest({
    currentPolicy: input.currentPolicy,
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    externalAuthority: isDirectGroupAdmin(
      input.currentPolicy,
      input.signerUserId,
    )
      ? null
      : requireExternalAuthority(input.externalAuthority).currentHead,
    keyEpoch: input.currentPolicy.currentState.keyEpoch + 1,
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    memberEnvelopes,
    principalId: input.currentPolicy.currentState.principalId,
    projection,
    signedAt: new Date().toISOString(),
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
}

export async function buildGroupAccessSetShrinkPolicyRequest(
  input: BuildGroupMembershipMutationInput & {
    readonly currentUsers: ReadonlyArray<TrustedUserIdentity>;
  },
): Promise<GroupPolicyMutationRequest> {
  await verifyGroupPolicy({
    currentPolicy: input.currentPolicy,
    ...(input.externalAuthority
      ? { externalAuthority: input.externalAuthority }
      : {}),
    localPolicyCheckpoint: input.localPolicyCheckpoint ?? null,
    signerPublicKeys: input.currentPolicySignerPublicKeys,
  });
  requireSignerCanManageGroup(
    input.currentPolicy,
    input.currentOrgAdminUserIds ?? [],
    input.signerUserId,
  );

  const groupKem = generateKemSeedAndKeyPair();
  const projection = [...input.currentPolicy.currentProjection];
  const memberEnvelopes = await rewrapProjectionMemberEnvelopes({
    projection,
    secretKey: groupKem.secretKey,
    users: input.currentUsers,
  });
  return signedGroupPolicyRequest({
    currentPolicy: input.currentPolicy,
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    externalAuthority: isDirectGroupAdmin(
      input.currentPolicy,
      input.signerUserId,
    )
      ? null
      : requireExternalAuthority(input.externalAuthority).currentHead,
    keyEpoch: input.currentPolicy.currentState.keyEpoch + 1,
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    memberEnvelopes,
    principalId: input.currentPolicy.currentState.principalId,
    projection,
    signedAt: new Date().toISOString(),
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
}

export async function createOrganizationGroup(input: {
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly creatorEncapsulationKeyPair: EncapsulationKeyPair;
  readonly execSql: ExecSql;
  readonly name: string;
  readonly organizationId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<OrganizationGroupSummaryResponse> {
  const externalAdminPolicy = await loadOrganizationExternalAdminPolicy({
    execSql: input.execSql,
    getCurrentPrincipalPolicy: (principalType, principalId) =>
      input.apiClient.getCurrentPrincipalPolicy(principalType, principalId),
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if (!externalAdminPolicy) {
    throw new Error("Organization admin authority could not be verified");
  }
  if (!externalAdminPolicy.signerUserIds.includes(input.signerUserId)) {
    throw new Error("Organization admin authority could not be verified");
  }
  const request = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: input.creatorEncapsulationKeyPair,
    externalAuthority: externalAdminPolicy.externalAuthority.currentHead,
    groupId: crypto.randomUUID(),
    includeSignerAsAdmin: false,
    name: input.name,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const group = await input.apiClient.createOrganizationGroup(
    input.organizationId,
    request,
  );

  if (!group) {
    throw new Error("Group could not be created");
  }
  const expectedHead = await groupPolicyMutationHead(
    request.initialGroupPolicy,
  );
  const acknowledged = await acknowledgeInitialGroupPolicy({
    organizationId: input.organizationId,
    request,
    response: group,
    stateHash: expectedHead.stateHash,
  });
  await persistLocallyAcknowledgedPrincipalPolicyBundle({
    bundle: acknowledged.bundle,
    execSql: input.execSql,
    policy: acknowledged.policy,
    updatedAt: new Date().toISOString(),
  });

  await cacheGroupPolicy({
    acknowledgedMemberEnvelopes: acknowledged.bundle.currentMemberEnvelopes,
    apiClient: input.apiClient,
    execSql: input.execSql,
    expectedCurrentHead: expectedHead,
    externalAuthority: externalAdminPolicy.externalAuthority,
    groupId: group.groupId,
    localPolicyCheckpoint: acknowledged.policy.checkpoint,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  return group;
}

export async function addOrganizationGroupUser(input: {
  readonly afterPolicyCommitBeforeCache: () => Promise<void>;
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly currentUserSecretKey: Uint8Array;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly organizationId: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
  readonly targetUserId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly beforePolicyCommit: (
    head: ReferencedPrincipalHead,
    authority: {
      readonly adminGroupId: string;
      readonly memberGroupId: string;
    },
  ) => void;
  readonly prepareContainerMutations?:
    | ((input: {
        readonly nextPolicy: VerifiedPrincipalPolicy;
      }) => Promise<ContainerMutationRequest[]>)
    | undefined;
}): Promise<PrincipalPolicyBundleResponse> {
  const policyContext = await loadGroupPolicyMutationContext({
    apiClient: input.apiClient,
    execSql: input.execSql,
    groupId: input.groupId,
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const identities = await resolveRequiredUserIdentities({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    userIds: [
      ...projectionUserIds(policyContext.currentPolicy.currentProjection),
      input.targetUserId,
    ],
  });
  const targetUser = identities.find(
    (identity) => identity.userId === input.targetUserId,
  );
  if (!targetUser) {
    throw new Error(
      `User identity could not be loaded for ${input.targetUserId}`,
    );
  }
  const request = await buildAddGroupUserPolicyRequest({
    ...policyContext,
    currentUserSecretKey: input.currentUserSecretKey,
    currentUsers: identities.filter(
      (identity) => identity.userId !== input.targetUserId,
    ),
    targetUser,
  });
  const expectedHead = await groupPolicyMutationHead(request);
  input.beforePolicyCommit(expectedHead, {
    adminGroupId: policyContext.adminGroupId,
    memberGroupId: policyContext.memberGroupId,
  });
  if (input.prepareContainerMutations) {
    request.containerMutations = await input.prepareContainerMutations({
      nextPolicy: await prepareAuthoredGroupPolicy({
        currentPolicy: policyContext.currentPolicy,
        expectedHead,
        request,
      }),
    });
  }
  const acknowledgedBundle = await commitGroupPolicyMutation({
    apiClient: input.apiClient,
    currentPolicy: policyContext.currentPolicy,
    execSql: input.execSql,
    expectedHead,
    groupId: input.groupId,
    request,
  });
  await input.afterPolicyCommitBeforeCache();
  return cacheGroupPolicy({
    acknowledgedMemberEnvelopes: acknowledgedBundle.currentMemberEnvelopes,
    apiClient: input.apiClient,
    execSql: input.execSql,
    expectedCurrentHead: expectedHead,
    externalAuthority: policyContext.externalAuthority,
    groupId: input.groupId,
    localPolicyCheckpoint: {
      principalId: expectedHead.principalId,
      principalType: expectedHead.principalType,
      stateHash: expectedHead.stateHash,
      version: expectedHead.version,
    },
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
}

export async function removeOrganizationGroupUser(input: {
  readonly afterPolicyCommitBeforeCache: () => Promise<void>;
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly organizationId: string;
  readonly removedUserId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
  readonly beforePolicyCommit: (
    head: ReferencedPrincipalHead,
    authority: {
      readonly adminGroupId: string;
      readonly memberGroupId: string;
    },
  ) => void;
  readonly prepareContainerMutations?:
    | ((input: {
        readonly nextPolicy: VerifiedPrincipalPolicy;
      }) => Promise<ContainerMutationRequest[]>)
    | undefined;
}): Promise<PrincipalPolicyBundleResponse> {
  const policyContext = await loadGroupPolicyMutationContext({
    apiClient: input.apiClient,
    execSql: input.execSql,
    groupId: input.groupId,
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const removedKey = projectionMemberKey({
    userId: input.removedUserId,
  });
  const projection = policyContext.currentPolicy.currentProjection.filter(
    (member) => projectionMemberKey(member) !== removedKey,
  );
  if (
    projection.length === policyContext.currentPolicy.currentProjection.length
  ) {
    throw new Error("User is not a group member");
  }
  const remainingUsers = await resolveRequiredUserIdentities({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    userIds: projectionUserIds(projection),
  });
  const request = await buildRemoveGroupUserPolicyRequest({
    ...policyContext,
    remainingUsers,
    removedUserId: input.removedUserId,
  });
  const expectedHead = await groupPolicyMutationHead(request);
  input.beforePolicyCommit(expectedHead, {
    adminGroupId: policyContext.adminGroupId,
    memberGroupId: policyContext.memberGroupId,
  });
  if (input.prepareContainerMutations) {
    request.containerMutations = await input.prepareContainerMutations({
      nextPolicy: await prepareAuthoredGroupPolicy({
        currentPolicy: policyContext.currentPolicy,
        expectedHead,
        request,
      }),
    });
  }
  const acknowledgedBundle = await commitGroupPolicyMutation({
    apiClient: input.apiClient,
    currentPolicy: policyContext.currentPolicy,
    execSql: input.execSql,
    expectedHead,
    groupId: input.groupId,
    request,
  });
  await input.afterPolicyCommitBeforeCache();
  return cacheGroupPolicy({
    acknowledgedMemberEnvelopes: acknowledgedBundle.currentMemberEnvelopes,
    apiClient: input.apiClient,
    execSql: input.execSql,
    expectedCurrentHead: expectedHead,
    externalAuthority: policyContext.externalAuthority,
    groupId: input.groupId,
    localPolicyCheckpoint: {
      principalId: expectedHead.principalId,
      principalType: expectedHead.principalType,
      stateHash: expectedHead.stateHash,
      version: expectedHead.version,
    },
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
}

/**
 * A group losing a container grant rotates its own key in the same request as
 * that container revoke and the rekeys of all remaining grants. This prevents
 * a later member from using the group's still-current key to open a retained
 * wrap from before the revoke.
 */
export async function rotateOrganizationGroupForAccessSetShrink(input: {
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly organizationId: string;
  readonly prepareContainerMutations: (input: {
    readonly nextPolicy: VerifiedPrincipalPolicy;
  }) => Promise<ContainerMutationRequest[]>;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<PrincipalPolicyBundleResponse> {
  const policyContext = await loadGroupPolicyMutationContext({
    apiClient: input.apiClient,
    execSql: input.execSql,
    groupId: input.groupId,
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const currentUsers = await resolveRequiredUserIdentities({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    userIds: projectionUserIds(policyContext.currentPolicy.currentProjection),
  });
  const request = await buildGroupAccessSetShrinkPolicyRequest({
    ...policyContext,
    currentUsers,
  });
  const expectedHead = await groupPolicyMutationHead(request);
  request.containerMutations = await input.prepareContainerMutations({
    nextPolicy: await prepareAuthoredGroupPolicy({
      currentPolicy: policyContext.currentPolicy,
      expectedHead,
      request,
    }),
  });
  const acknowledgedBundle = await commitGroupPolicyMutation({
    apiClient: input.apiClient,
    currentPolicy: policyContext.currentPolicy,
    execSql: input.execSql,
    expectedHead,
    groupId: input.groupId,
    request,
  });
  return cacheGroupPolicy({
    acknowledgedMemberEnvelopes: acknowledgedBundle.currentMemberEnvelopes,
    apiClient: input.apiClient,
    execSql: input.execSql,
    expectedCurrentHead: expectedHead,
    externalAuthority: policyContext.externalAuthority,
    groupId: input.groupId,
    localPolicyCheckpoint: {
      principalId: expectedHead.principalId,
      principalType: expectedHead.principalType,
      stateHash: expectedHead.stateHash,
      version: expectedHead.version,
    },
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
}
