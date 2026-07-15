import {
  buildPrincipalStateSigningInput,
  type EncapsulationKeyPair,
  generateKemSeedAndKeyPair,
  normalizePrincipalProjectionMembers,
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicySignerPublicKey,
  type ReferencedPrincipalHead,
  type SigningKeyPair,
  signPrincipalState,
  toFingerprint,
  unwrapDek,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type {
  CreateOrganizationGroupRequest,
  PrincipalMemberEnvelopeRequest,
  PrincipalProjectionMemberRequest,
  PutPrincipalMemberEnvelopesRequest,
  PutPrincipalStateRequest,
} from "@tearleads/validators/request";
import type {
  CurrentPrincipalMemberEnvelopesResponse,
  EncapsulationKeyResponse,
  OrganizationGroupSummaryResponse,
  PrincipalMemberEnvelopeResponse,
  PrincipalPolicyBundleResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import { advanceKeyingCheckpointsAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import {
  persistLocallyAcknowledgedPrincipalPolicyBundle,
  retainLocallyAcknowledgedPrincipalPolicyBundle,
} from "../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import {
  retainVerifiedPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  acknowledgeGroupPolicyState,
  acknowledgeInitialGroupPolicy,
  assertGroupPolicyEnvelopesMatchAcknowledgement,
  groupPolicyBundleFromAcknowledgement,
} from "./groupPolicyMutationAcknowledgement";
import {
  assertPrincipalPolicyCurrentStateMatchesHead,
  groupPolicyMutationHead,
} from "./groupPolicyMutationHead";
import {
  collectGroupPolicySignerPublicKeys,
  prepareGroupPolicyVerification,
  verifyGroupPolicy,
} from "./groupPolicyVerification";
import {
  ensureNoNestedGroupMembers,
  hasAdmin,
} from "./principalPolicyProjection";
import {
  loadOrganizationGroupRecipients,
  type OrganizationGroupRecipient,
  remainingGroupMemberIds,
  rewrapProjectionMemberEnvelopes,
} from "./principalPolicyRecipients";

export interface OrganizationUserRecipient {
  readonly userId: string;
  readonly encapsulationPublicKey: string;
  readonly encapsulationKeyFingerprint: string;
}

interface OrganizationPrincipalPolicyApi {
  createOrganizationGroup: (
    organizationId: string,
    input: CreateOrganizationGroupRequest,
  ) => Promise<OrganizationGroupSummaryResponse | null>;
  getEncapsulationKey: (
    userId: string,
  ) => Promise<EncapsulationKeyResponse | null>;
  getCurrentPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
  putPrincipalMemberEnvelopes: (
    principalType: "group" | "organization",
    principalId: string,
    input: PutPrincipalMemberEnvelopesRequest,
  ) => Promise<CurrentPrincipalMemberEnvelopesResponse | null>;
  putPrincipalState: (
    principalType: "group" | "organization",
    principalId: string,
    input: PutPrincipalStateRequest,
  ) => Promise<PrincipalStateResponse | null>;
}

export async function importOrganizationUserRecipient(input: {
  readonly apiClient: Pick<
    OrganizationPrincipalPolicyApi,
    "getEncapsulationKey"
  >;
  readonly userId: string;
}): Promise<OrganizationUserRecipient | null> {
  const userId = input.userId.trim();
  if (userId.length === 0) {
    return null;
  }

  const response = await input.apiClient.getEncapsulationKey(userId);
  if (!response) {
    return null;
  }

  return {
    userId: response.userId,
    encapsulationPublicKey: response.encapsulationPublicKey,
    encapsulationKeyFingerprint: await toFingerprint(
      base64ToBytes(response.encapsulationPublicKey),
    ),
  };
}

interface BuildInitialGroupPolicyInput {
  readonly creatorEncapsulationKeyPair: EncapsulationKeyPair;
  readonly groupId: string;
  readonly includeSignerAsAdmin?: boolean;
  readonly name: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}

interface BuildGroupMembershipMutationInput {
  readonly canAdministerOrganization: boolean;
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly currentPolicySignerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
  readonly localPolicyCheckpoint?: PrincipalPolicyCheckpoint | null;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}

type GroupPolicyMutationRequest = {
  readonly memberEnvelopes: ReadonlyArray<PrincipalMemberEnvelopeRequest>;
  readonly state: PutPrincipalStateRequest;
};

type BuildAddGroupUserPolicyInput = BuildGroupMembershipMutationInput & {
  readonly currentUsers: ReadonlyArray<OrganizationUserRecipient>;
  readonly currentUserSecretKey: Uint8Array;
  readonly targetUser: OrganizationUserRecipient;
};

function projectionMemberKey(member: {
  readonly memberPrincipalType: "user" | "group";
  readonly memberPrincipalId: string;
}): string {
  return `${member.memberPrincipalType}:${member.memberPrincipalId}`;
}

function userProjectionMember(
  userId: string,
  role: "member" | "admin",
): PrincipalProjectionMemberRequest {
  return { memberPrincipalType: "user", memberPrincipalId: userId, role };
}

function projectionToStateMembers(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
) {
  return projection.map((member) => ({
    principalType: member.memberPrincipalType,
    principalId: member.memberPrincipalId,
  }));
}

function payloadCiphertextForProjection(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): string {
  return bytesToBase64(
    new TextEncoder().encode(JSON.stringify({ members: projection })),
  );
}

function toPrincipalMemberEnvelopeRequest(input: {
  readonly envelope: {
    readonly keyFingerprint: string;
    readonly kemCipherText: Uint8Array;
    readonly wrappedKey: Uint8Array;
  };
  readonly memberPrincipalId: string;
  readonly memberPrincipalType: "user" | "group";
}): PrincipalMemberEnvelopeRequest {
  return {
    memberPrincipalType: input.memberPrincipalType,
    memberPrincipalId: input.memberPrincipalId,
    memberKeyFingerprint: input.envelope.keyFingerprint,
    kemCipherText: bytesToBase64(input.envelope.kemCipherText),
    wrappedKey: bytesToBase64(input.envelope.wrappedKey),
  };
}

function toRecipientEntries(
  envelopes: ReadonlyArray<PrincipalMemberEnvelopeResponse>,
) {
  return envelopes.map((envelope) => ({
    keyFingerprint: envelope.memberKeyFingerprint,
    kemCipherText: base64ToBytes(envelope.kemCipherText),
    wrappedKey: base64ToBytes(envelope.wrappedKey),
  }));
}

function requireSignerCanManageGroup(
  currentPolicy: PrincipalPolicyBundleResponse,
  canAdministerOrganization: boolean,
  signerUserId: string,
): void {
  if (canAdministerOrganization) {
    return;
  }

  const signerMember = currentPolicy.currentProjection.find(
    (member) =>
      member.memberPrincipalType === "user" &&
      member.memberPrincipalId === signerUserId,
  );

  if (signerMember?.role !== "admin") {
    throw new Error("Group admin membership is required");
  }
}

function isDirectGroupAdmin(
  currentPolicy: PrincipalPolicyBundleResponse,
  signerUserId: string,
): boolean {
  return currentPolicy.currentProjection.some(
    (member) =>
      member.memberPrincipalType === "user" &&
      member.memberPrincipalId === signerUserId &&
      member.role === "admin",
  );
}

async function signedGroupStateRequest(input: {
  readonly currentPolicy?: PrincipalPolicyBundleResponse;
  readonly encapsulationPublicKey: string;
  readonly keyEpoch: number;
  readonly keyFingerprint: string;
  readonly principalId: string;
  readonly projection: ReadonlyArray<PrincipalProjectionMemberRequest>;
  readonly signedAt: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<PutPrincipalStateRequest> {
  const projection = normalizePrincipalProjectionMembers(input.projection);
  const payloadCiphertext = payloadCiphertextForProjection(projection);
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: input.principalId,
      version: input.currentPolicy
        ? input.currentPolicy.currentState.version + 1
        : 1,
      prevStateHash: input.currentPolicy?.currentState.stateHash ?? null,
      keyEpoch: input.keyEpoch,
      encapsulationPublicKey: input.encapsulationPublicKey,
      keyFingerprint: input.keyFingerprint,
      members: projectionToStateMembers(projection),
      projection,
      payloadCiphertext,
      signedAt: input.signedAt,
      signerUserId: input.signerUserId,
      signerUserKeyFingerprint: input.signingFingerprint,
    }),
    input.signingKeyPair.signingPrivateKey,
  );

  return {
    state,
    encryptedPayload: {
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: state.payloadCiphertextHash,
    },
    projection,
  };
}

async function cacheGroupPolicy(input: {
  readonly acknowledgedMemberEnvelopes?:
    | CurrentPrincipalMemberEnvelopesResponse
    | undefined;
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly canAdministerOrganization?: boolean;
  readonly execSql: ExecSql;
  readonly expectedCurrentHead?: ReferencedPrincipalHead | undefined;
  readonly groupId: string;
  readonly localPolicyCheckpoint?: PrincipalPolicyCheckpoint | null;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<PrincipalPolicyBundleResponse> {
  const bundle = await input.apiClient.getCurrentPrincipalPolicy(
    "group",
    input.groupId,
  );

  if (!bundle) {
    throw new Error("Updated group policy could not be loaded");
  }

  const signerPublicKeys = await collectGroupPolicySignerPublicKeys({
    apiClient: input.apiClient,
    bundle,
    currentUserSigningKey: {
      signerUserId: input.signerUserId,
      signingFingerprint: input.signingFingerprint,
      signingKeyPair: input.signingKeyPair,
    },
  });
  const verified = await verifyGroupPolicy({
    currentPolicy: bundle,
    externalAdminSignerUserIds: input.canAdministerOrganization
      ? [input.signerUserId]
      : [],
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
  readonly canAdministerOrganization: boolean;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<BuildGroupMembershipMutationInput> {
  const currentPolicy = await input.apiClient.getCurrentPrincipalPolicy(
    "group",
    input.groupId,
  );

  if (!currentPolicy) {
    throw new Error("Group policy could not be loaded");
  }

  const verification = await prepareGroupPolicyVerification({
    apiClient: input.apiClient,
    currentPolicy,
    execSql: input.execSql,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const verified = await verifyGroupPolicy({
    currentPolicy,
    externalAdminSignerUserIds: input.canAdministerOrganization
      ? [input.signerUserId]
      : [],
    localPolicyCheckpoint: verification.localPolicyCheckpoint,
    signerPublicKeys: verification.currentPolicySignerPublicKeys,
  });
  await retainVerifiedPrincipalPolicyBundle({
    bundle: currentPolicy,
    execSql: input.execSql,
    policy: verified,
    updatedAt: new Date().toISOString(),
  });
  await advanceKeyingCheckpointsAtomically({
    access: [],
    execSql: input.execSql,
    policies: [verified],
  });

  return {
    canAdministerOrganization: input.canAdministerOrganization,
    currentPolicy,
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
  const storedState = await input.apiClient.putPrincipalState(
    "group",
    input.groupId,
    input.request.state,
  );

  if (!storedState) {
    throw new Error("Group policy update failed");
  }
  const acknowledgedPolicy = await acknowledgeGroupPolicyState({
    currentPolicy: input.currentPolicy,
    expectedHead: input.expectedHead,
    request: input.request.state,
    response: storedState,
  });

  const storedEnvelopes = await input.apiClient.putPrincipalMemberEnvelopes(
    "group",
    input.groupId,
    {
      stateHash: input.expectedHead.stateHash,
      envelopes: [...input.request.memberEnvelopes],
    },
  );

  if (!storedEnvelopes) {
    throw new Error("Group member envelopes update failed");
  }
  const bundle = groupPolicyBundleFromAcknowledgement({
    currentPolicy: input.currentPolicy,
    envelopes: storedEnvelopes,
    expectedHead: input.expectedHead,
    memberEnvelopes: input.request.memberEnvelopes,
    state: storedState,
    stateRequest: input.request.state,
  });
  await retainLocallyAcknowledgedPrincipalPolicyBundle({
    bundle,
    execSql: input.execSql,
    policy: acknowledgedPolicy,
    updatedAt: new Date().toISOString(),
  });
  return bundle;
}

export async function buildInitialGroupPolicyRequest(
  input: BuildInitialGroupPolicyInput,
): Promise<CreateOrganizationGroupRequest> {
  const groupKem = generateKemSeedAndKeyPair();
  const withSigner = input.includeSignerAsAdmin ?? true;
  const projection = withSigner
    ? [userProjectionMember(input.signerUserId, "admin")]
    : [];
  const stateRequest = await signedGroupStateRequest({
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    keyEpoch: 1,
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    principalId: input.groupId,
    projection,
    signedAt: new Date().toISOString(),
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const memberEnvelopes: PrincipalMemberEnvelopeRequest[] = [];

  if (withSigner) {
    const creatorFingerprint = await toFingerprint(
      input.creatorEncapsulationKeyPair.publicKey,
    );
    const [creatorEnvelope] = await wrapDekForRecipients(groupKem.secretKey, [
      input.creatorEncapsulationKeyPair.publicKey,
    ]);

    if (!creatorEnvelope) {
      throw new Error("Failed to wrap group key for creator");
    }

    memberEnvelopes.push({
      memberPrincipalType: "user",
      memberPrincipalId: input.signerUserId,
      memberKeyFingerprint: creatorFingerprint,
      kemCipherText: bytesToBase64(creatorEnvelope.kemCipherText),
      wrappedKey: bytesToBase64(creatorEnvelope.wrappedKey),
    });
  }

  return {
    groupId: input.groupId,
    name: input.name.trim(),
    initialGroupPolicy: {
      ...stateRequest,
      memberEnvelopes,
    },
  };
}

export async function buildInitialMemberGroupPolicyRequest(input: {
  readonly adminGroup: CreateOrganizationGroupRequest;
  readonly creatorEncapsulationKeyPair: EncapsulationKeyPair;
  readonly groupId: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<CreateOrganizationGroupRequest> {
  const groupKem = generateKemSeedAndKeyPair();
  const creatorFingerprint = await toFingerprint(
    input.creatorEncapsulationKeyPair.publicKey,
  );
  const projection = normalizePrincipalProjectionMembers([
    userProjectionMember(input.signerUserId, "admin"),
    {
      memberPrincipalType: "group",
      memberPrincipalId: input.adminGroup.groupId,
      role: "member",
    },
  ]);
  const stateRequest = await signedGroupStateRequest({
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    keyEpoch: 1,
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    principalId: input.groupId,
    projection,
    signedAt: new Date().toISOString(),
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const [creatorEnvelope] = await wrapDekForRecipients(groupKem.secretKey, [
    input.creatorEncapsulationKeyPair.publicKey,
  ]);
  const [adminGroupEnvelope] = await wrapDekForRecipients(groupKem.secretKey, [
    base64ToBytes(
      input.adminGroup.initialGroupPolicy.state.encapsulationPublicKey,
    ),
  ]);

  if (!creatorEnvelope || !adminGroupEnvelope) {
    throw new Error("Failed to wrap member group key");
  }

  return {
    groupId: input.groupId,
    name: "Members",
    initialGroupPolicy: {
      ...stateRequest,
      memberEnvelopes: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: input.signerUserId,
          memberKeyFingerprint: creatorFingerprint,
          kemCipherText: bytesToBase64(creatorEnvelope.kemCipherText),
          wrappedKey: bytesToBase64(creatorEnvelope.wrappedKey),
        },
        {
          memberPrincipalType: "group",
          memberPrincipalId: input.adminGroup.groupId,
          memberKeyFingerprint:
            input.adminGroup.initialGroupPolicy.state.keyFingerprint,
          kemCipherText: bytesToBase64(adminGroupEnvelope.kemCipherText),
          wrappedKey: bytesToBase64(adminGroupEnvelope.wrappedKey),
        },
      ],
    },
  };
}

async function buildOrgAdminAddGroupUserPolicyRequest(
  input: BuildAddGroupUserPolicyInput,
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): Promise<GroupPolicyMutationRequest> {
  ensureNoNestedGroupMembers(projection);

  const groupKem = generateKemSeedAndKeyPair();
  const usersById = new Map([
    ...input.currentUsers.map((user) => [user.userId, user] as const),
    [input.targetUser.userId, input.targetUser] as const,
  ]);
  const recipientUsers = projection.map((member) => {
    const user = usersById.get(member.memberPrincipalId);
    if (!user) {
      throw new Error(
        `Missing recipient key for user ${member.memberPrincipalId}`,
      );
    }

    return user;
  });
  const wrappedRecipients = await wrapDekForRecipients(
    groupKem.secretKey,
    recipientUsers.map((user) => base64ToBytes(user.encapsulationPublicKey)),
  );
  const state = await signedGroupStateRequest({
    currentPolicy: input.currentPolicy,
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    keyEpoch: input.currentPolicy.currentState.keyEpoch + 1,
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    principalId: input.currentPolicy.currentState.principalId,
    projection,
    signedAt: new Date().toISOString(),
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });

  return {
    state,
    memberEnvelopes: wrappedRecipients.map((envelope, index) =>
      toPrincipalMemberEnvelopeRequest({
        envelope,
        memberPrincipalType: "user",
        memberPrincipalId: recipientUsers[index]?.userId ?? "",
      }),
    ),
  };
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
    base64ToBytes(input.targetUser.encapsulationPublicKey),
  ]);

  if (!targetEnvelope) {
    throw new Error("Failed to wrap group key for target user");
  }

  const state = await signedGroupStateRequest({
    currentPolicy: input.currentPolicy,
    encapsulationPublicKey:
      input.currentPolicy.currentState.encapsulationPublicKey,
    keyEpoch: input.currentPolicy.currentState.keyEpoch,
    keyFingerprint: input.currentPolicy.currentState.keyFingerprint,
    principalId: input.currentPolicy.currentState.principalId,
    projection,
    signedAt: new Date().toISOString(),
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });

  return {
    state,
    memberEnvelopes: [
      ...input.currentPolicy.currentMemberEnvelopes.envelopes.filter(
        (envelope) => projectionMemberKey(envelope) !== targetKey,
      ),
      {
        memberPrincipalType: "user",
        memberPrincipalId: input.targetUser.userId,
        memberKeyFingerprint: input.targetUser.encapsulationKeyFingerprint,
        kemCipherText: bytesToBase64(targetEnvelope.kemCipherText),
        wrappedKey: bytesToBase64(targetEnvelope.wrappedKey),
      },
    ],
  };
}

export async function buildAddGroupUserPolicyRequest(
  input: BuildAddGroupUserPolicyInput,
): Promise<GroupPolicyMutationRequest> {
  await verifyGroupPolicy({
    currentPolicy: input.currentPolicy,
    externalAdminSignerUserIds: input.canAdministerOrganization
      ? [input.signerUserId]
      : [],
    localPolicyCheckpoint: input.localPolicyCheckpoint ?? null,
    signerPublicKeys: input.currentPolicySignerPublicKeys,
  });
  requireSignerCanManageGroup(
    input.currentPolicy,
    input.canAdministerOrganization,
    input.signerUserId,
  );

  const targetKey = projectionMemberKey({
    memberPrincipalType: "user",
    memberPrincipalId: input.targetUser.userId,
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
    userProjectionMember(input.targetUser.userId, "member"),
  ];

  return isDirectGroupAdmin(input.currentPolicy, input.signerUserId)
    ? buildDirectAdminAddGroupUserPolicyRequest(input, projection, targetKey)
    : buildOrgAdminAddGroupUserPolicyRequest(input, projection);
}

export async function buildRemoveGroupUserPolicyRequest(
  input: BuildGroupMembershipMutationInput & {
    readonly remainingGroups?: ReadonlyArray<OrganizationGroupRecipient>;
    readonly remainingUsers: ReadonlyArray<OrganizationUserRecipient>;
    readonly removedUserId: string;
  },
): Promise<GroupPolicyMutationRequest> {
  await verifyGroupPolicy({
    currentPolicy: input.currentPolicy,
    externalAdminSignerUserIds: input.canAdministerOrganization
      ? [input.signerUserId]
      : [],
    localPolicyCheckpoint: input.localPolicyCheckpoint ?? null,
    signerPublicKeys: input.currentPolicySignerPublicKeys,
  });
  requireSignerCanManageGroup(
    input.currentPolicy,
    input.canAdministerOrganization,
    input.signerUserId,
  );

  const key = projectionMemberKey({
    memberPrincipalType: "user",
    memberPrincipalId: input.removedUserId,
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
    groups: input.remainingGroups,
    projection,
    secretKey: groupKem.secretKey,
    users: input.remainingUsers,
  });
  const state = await signedGroupStateRequest({
    currentPolicy: input.currentPolicy,
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    keyEpoch: input.currentPolicy.currentState.keyEpoch + 1,
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    principalId: input.currentPolicy.currentState.principalId,
    projection,
    signedAt: new Date().toISOString(),
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });

  return {
    state,
    memberEnvelopes,
  };
}

export async function createOrganizationGroup(input: {
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly creatorEncapsulationKeyPair: EncapsulationKeyPair;
  readonly execSql: ExecSql;
  readonly name: string;
  readonly organizationId: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<OrganizationGroupSummaryResponse> {
  const request = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: input.creatorEncapsulationKeyPair,
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
    canAdministerOrganization: true,
    execSql: input.execSql,
    expectedCurrentHead: expectedHead,
    groupId: group.groupId,
    localPolicyCheckpoint: acknowledged.policy.checkpoint,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  return group;
}

export async function addOrganizationGroupUser(input: {
  readonly afterPolicyCommitBeforeCache: () => Promise<void>;
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly canAdministerOrganization: boolean;
  readonly currentUserSecretKey: Uint8Array;
  readonly currentUsers: ReadonlyArray<OrganizationUserRecipient>;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
  readonly targetUser: OrganizationUserRecipient;
  readonly beforePolicyCommit: (head: ReferencedPrincipalHead) => void;
}): Promise<PrincipalPolicyBundleResponse> {
  const policyContext = await loadGroupPolicyMutationContext({
    apiClient: input.apiClient,
    canAdministerOrganization: input.canAdministerOrganization,
    execSql: input.execSql,
    groupId: input.groupId,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const request = await buildAddGroupUserPolicyRequest({
    ...policyContext,
    currentUserSecretKey: input.currentUserSecretKey,
    currentUsers: input.currentUsers,
    targetUser: input.targetUser,
  });
  const expectedHead = await groupPolicyMutationHead(request.state);
  input.beforePolicyCommit(expectedHead);
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
    canAdministerOrganization: input.canAdministerOrganization,
    execSql: input.execSql,
    expectedCurrentHead: expectedHead,
    groupId: input.groupId,
    localPolicyCheckpoint: {
      principalId: expectedHead.principalId,
      principalType: expectedHead.principalType,
      stateHash: expectedHead.stateHash,
      version: expectedHead.version,
    },
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
}

export async function removeOrganizationGroupUser(input: {
  readonly afterPolicyCommitBeforeCache: () => Promise<void>;
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly canAdministerOrganization: boolean;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly remainingUsers: ReadonlyArray<OrganizationUserRecipient>;
  readonly removedUserId: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
  readonly beforePolicyCommit: (head: ReferencedPrincipalHead) => void;
}): Promise<PrincipalPolicyBundleResponse> {
  const policyContext = await loadGroupPolicyMutationContext({
    apiClient: input.apiClient,
    canAdministerOrganization: input.canAdministerOrganization,
    execSql: input.execSql,
    groupId: input.groupId,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const removedKey = projectionMemberKey({
    memberPrincipalType: "user",
    memberPrincipalId: input.removedUserId,
  });
  const projection = policyContext.currentPolicy.currentProjection.filter(
    (member) => projectionMemberKey(member) !== removedKey,
  );
  if (
    projection.length === policyContext.currentPolicy.currentProjection.length
  ) {
    throw new Error("User is not a group member");
  }
  const gs = await loadOrganizationGroupRecipients({
    apiClient: input.apiClient,
    groupIds: remainingGroupMemberIds(projection),
  });
  const request = await buildRemoveGroupUserPolicyRequest({
    ...policyContext,
    remainingGroups: gs,
    remainingUsers: input.remainingUsers,
    removedUserId: input.removedUserId,
  });
  const expectedHead = await groupPolicyMutationHead(request.state);
  input.beforePolicyCommit(expectedHead);
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
    canAdministerOrganization: input.canAdministerOrganization,
    execSql: input.execSql,
    expectedCurrentHead: expectedHead,
    groupId: input.groupId,
    localPolicyCheckpoint: {
      principalId: expectedHead.principalId,
      principalType: expectedHead.principalType,
      stateHash: expectedHead.stateHash,
      version: expectedHead.version,
    },
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
}
