import {
  buildPrincipalStateSigningInput,
  type EncapsulationKeyPair,
  generateKemSeedAndKeyPair,
  normalizePrincipalProjectionMembers,
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicySignerPublicKey,
  type SigningKeyPair,
  signPrincipalState,
  toFingerprint,
  unwrapDek,
  verifyPrincipalPolicyBundle,
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
  EncapsulationKeyResponse,
  OrganizationGroupSummaryResponse,
  PrincipalMemberEnvelopeResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import {
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  collectPrincipalPolicySignerPublicKeys,
  type PrincipalPolicySignerPublicKeyLoadErrorCode,
  principalPolicyCheckpoint,
} from "../principals/policyVerification";
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
  ) => Promise<unknown>;
  putPrincipalState: (
    principalType: "group" | "organization",
    principalId: string,
    input: PutPrincipalStateRequest,
  ) => Promise<unknown>;
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

function expectedGroupPolicyReference(bundle: PrincipalPolicyBundleResponse) {
  return {
    principalType: "group" as const,
    principalId: bundle.currentState.principalId,
    version: bundle.currentState.version,
    keyEpoch: bundle.currentState.keyEpoch,
    stateHash: bundle.currentState.stateHash,
    keyFingerprint: bundle.currentState.keyFingerprint,
  };
}

function groupPolicySignerPublicKeyLoadErrorMessage(
  code: PrincipalPolicySignerPublicKeyLoadErrorCode,
): string {
  switch (code) {
    case "fingerprint-invalid":
      return "Group policy signer key fingerprint is invalid";
    case "fingerprint-mismatch":
      return "Group policy signer key fingerprint mismatch";
    case "not-found":
      return "Group policy signer key could not be loaded";
    case "user-mismatch":
      return "Group policy signer key user mismatch";
  }
}

async function collectGroupPolicySignerPublicKeys(input: {
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly currentUserSigningKey: {
    readonly signerUserId: string;
    readonly signingFingerprint: string;
    readonly signingKeyPair: SigningKeyPair;
  };
}): Promise<PrincipalPolicySignerPublicKey[]> {
  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle: input.bundle,
    getEncapsulationKey: (userId) =>
      input.apiClient.getEncapsulationKey(userId),
    trustedSignerPublicKeys: [
      {
        signerUserId: input.currentUserSigningKey.signerUserId,
        signingFingerprint: input.currentUserSigningKey.signingFingerprint,
        signingPublicKey:
          input.currentUserSigningKey.signingKeyPair.signingPublicKey,
      },
    ],
  });

  if ("error" in signerPublicKeys) {
    throw new Error(
      groupPolicySignerPublicKeyLoadErrorMessage(signerPublicKeys.error),
    );
  }

  return signerPublicKeys.signerPublicKeys;
}

async function verifyGroupPolicy(input: {
  readonly externalAdminSignerUserIds?: readonly string[];
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly localPolicyCheckpoint: PrincipalPolicyCheckpoint | null;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
}): Promise<void> {
  const verified = await verifyPrincipalPolicyBundle({
    bundle: input.currentPolicy,
    ...(input.externalAdminSignerUserIds
      ? { externalAdminSignerUserIds: input.externalAdminSignerUserIds }
      : {}),
    expectedReference: expectedGroupPolicyReference(input.currentPolicy),
    localCheckpoint: input.localPolicyCheckpoint,
    signerPublicKeys: input.signerPublicKeys,
  });

  if (!verified.ok) {
    throw new Error(
      `Group policy verification failed: ${verified.error.message}`,
    );
  }
}

async function prepareGroupPolicyVerification(input: {
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly execSql: ExecSql;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<{
  readonly currentPolicySignerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
  readonly localPolicyCheckpoint: PrincipalPolicyCheckpoint | null;
}> {
  const cachedPolicy = await loadPrincipalPolicyBundle(
    input.execSql,
    "group",
    input.currentPolicy.currentState.principalId,
  );

  return {
    currentPolicySignerPublicKeys: await collectGroupPolicySignerPublicKeys({
      apiClient: input.apiClient,
      bundle: input.currentPolicy,
      currentUserSigningKey: {
        signerUserId: input.signerUserId,
        signingFingerprint: input.signingFingerprint,
        signingKeyPair: input.signingKeyPair,
      },
    }),
    localPolicyCheckpoint: principalPolicyCheckpoint(cachedPolicy),
  };
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

function ensureNoNestedGroupMembers(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): void {
  if (projection.some((member) => member.memberPrincipalType === "group")) {
    throw new Error(
      "Nested group membership is not supported in this version of organization administration",
    );
  }
}

function hasAdmin(projection: ReadonlyArray<PrincipalProjectionMemberRequest>) {
  return projection.some(
    (member) =>
      member.memberPrincipalType === "user" && member.role === "admin",
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
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly canAdministerOrganization?: boolean;
  readonly execSql: ExecSql;
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
  await verifyGroupPolicy({
    currentPolicy: bundle,
    externalAdminSignerUserIds: input.canAdministerOrganization
      ? [input.signerUserId]
      : [],
    localPolicyCheckpoint: input.localPolicyCheckpoint ?? null,
    signerPublicKeys,
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

  return {
    canAdministerOrganization: input.canAdministerOrganization,
    currentPolicy,
    ...verification,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  };
}

async function commitGroupPolicyMutation(input: {
  readonly apiClient: OrganizationPrincipalPolicyApi;
  readonly groupId: string;
  readonly request: GroupPolicyMutationRequest;
}): Promise<void> {
  const storedState = await input.apiClient.putPrincipalState(
    "group",
    input.groupId,
    input.request.state,
  );

  if (!storedState || typeof storedState !== "object") {
    throw new Error("Group policy update failed");
  }

  const stateHash = Reflect.get(storedState, "stateHash");
  if (typeof stateHash !== "string" || stateHash.length === 0) {
    throw new Error("Group policy update did not return a state hash");
  }

  const storedEnvelopes = await input.apiClient.putPrincipalMemberEnvelopes(
    "group",
    input.groupId,
    {
      stateHash,
      envelopes: [...input.request.memberEnvelopes],
    },
  );

  if (!storedEnvelopes) {
    throw new Error("Group member envelopes update failed");
  }
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

  await cacheGroupPolicy({
    apiClient: input.apiClient,
    canAdministerOrganization: true,
    execSql: input.execSql,
    groupId: group.groupId,
    localPolicyCheckpoint: null,
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
  await commitGroupPolicyMutation({
    apiClient: input.apiClient,
    groupId: input.groupId,
    request,
  });
  await input.afterPolicyCommitBeforeCache();

  return cacheGroupPolicy({
    apiClient: input.apiClient,
    canAdministerOrganization: input.canAdministerOrganization,
    execSql: input.execSql,
    groupId: input.groupId,
    localPolicyCheckpoint: principalPolicyCheckpoint(
      policyContext.currentPolicy,
    ),
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
  await commitGroupPolicyMutation({
    apiClient: input.apiClient,
    groupId: input.groupId,
    request,
  });
  await input.afterPolicyCommitBeforeCache();

  return cacheGroupPolicy({
    apiClient: input.apiClient,
    canAdministerOrganization: input.canAdministerOrganization,
    execSql: input.execSql,
    groupId: input.groupId,
    localPolicyCheckpoint: principalPolicyCheckpoint(
      policyContext.currentPolicy,
    ),
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
}
