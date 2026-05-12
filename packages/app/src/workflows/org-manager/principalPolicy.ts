import {
  buildPrincipalStateSigningInput,
  generateKemSeedAndKeyPair,
  normalizePrincipalProjectionMembers,
  type PrincipalProjectionMember,
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
  OrganizationGroupSummaryResponse,
  PrincipalMemberEnvelopeResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { savePrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

interface SigningKeyPair {
  readonly signingPrivateKey: Uint8Array;
  readonly signingPublicKey: Uint8Array;
}

interface EncapsulationKeyPair {
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
}

export interface OrgManagerUserRecipient {
  readonly userId: string;
  readonly encapsulationPublicKey: string;
  readonly encapsulationKeyFingerprint: string;
}

interface OrgManagerPrincipalPolicyApi {
  createOrganizationGroup: (
    organizationId: string,
    input: CreateOrganizationGroupRequest,
  ) => Promise<OrganizationGroupSummaryResponse | null>;
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

interface BuildInitialGroupPolicyInput {
  readonly creatorEncapsulationKeyPair: EncapsulationKeyPair;
  readonly groupId: string;
  readonly name: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}

interface BuildGroupMembershipMutationInput {
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}

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
  return {
    memberPrincipalType: "user",
    memberPrincipalId: userId,
    role,
  };
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
    new TextEncoder().encode(
      JSON.stringify({
        members: projection,
      }),
    ),
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
  signerUserId: string,
): void {
  const signerMember = currentPolicy.currentProjection.find(
    (member) =>
      member.memberPrincipalType === "user" &&
      member.memberPrincipalId === signerUserId,
  );

  if (signerMember?.role !== "admin") {
    throw new Error("Group admin membership is required");
  }
}

function ensureNoNestedGroupMembers(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): void {
  if (projection.some((member) => member.memberPrincipalType === "group")) {
    throw new Error(
      "Nested group membership is not supported in Org Manager v1",
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
  readonly currentPolicy?: PrincipalPolicyBundleResponse | undefined;
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
  const projection = normalizePrincipalProjectionMembers(
    input.projection as PrincipalProjectionMember[],
  );
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
  readonly apiClient: OrgManagerPrincipalPolicyApi;
  readonly execSql: ExecSql;
  readonly groupId: string;
}): Promise<PrincipalPolicyBundleResponse> {
  const bundle = await input.apiClient.getCurrentPrincipalPolicy(
    "group",
    input.groupId,
  );

  if (!bundle) {
    throw new Error("Updated group policy could not be loaded");
  }

  await savePrincipalPolicyBundle(
    input.execSql,
    bundle,
    new Date().toISOString(),
  );
  return bundle;
}

export async function buildInitialGroupPolicyRequest(
  input: BuildInitialGroupPolicyInput,
): Promise<CreateOrganizationGroupRequest> {
  const groupKem = generateKemSeedAndKeyPair();
  const creatorFingerprint = await toFingerprint(
    input.creatorEncapsulationKeyPair.publicKey,
  );
  const projection = [userProjectionMember(input.signerUserId, "admin")];
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

  if (!creatorEnvelope) {
    throw new Error("Failed to wrap group key for creator");
  }

  return {
    groupId: input.groupId,
    name: input.name.trim(),
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
      ],
    },
  };
}

export async function buildAddGroupUserPolicyRequest(
  input: BuildGroupMembershipMutationInput & {
    readonly currentUserSecretKey: Uint8Array;
    readonly targetUser: OrgManagerUserRecipient;
  },
): Promise<{
  readonly memberEnvelopes: PutPrincipalMemberEnvelopesRequest;
  readonly state: PutPrincipalStateRequest;
}> {
  requireSignerCanManageGroup(input.currentPolicy, input.signerUserId);

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

  const projection = [
    ...currentProjection,
    userProjectionMember(input.targetUser.userId, "member"),
  ];
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
    memberEnvelopes: {
      stateHash: "",
      envelopes: [
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
    },
  };
}

export async function buildRemoveGroupUserPolicyRequest(
  input: BuildGroupMembershipMutationInput & {
    readonly remainingUsers: ReadonlyArray<OrgManagerUserRecipient>;
    readonly removedUserId: string;
  },
): Promise<{
  readonly memberEnvelopes: PutPrincipalMemberEnvelopesRequest;
  readonly state: PutPrincipalStateRequest;
}> {
  requireSignerCanManageGroup(input.currentPolicy, input.signerUserId);

  const removedKey = projectionMemberKey({
    memberPrincipalType: "user",
    memberPrincipalId: input.removedUserId,
  });
  const projection = input.currentPolicy.currentProjection.filter(
    (member) => projectionMemberKey(member) !== removedKey,
  );

  if (projection.length === input.currentPolicy.currentProjection.length) {
    throw new Error("User is not a group member");
  }

  ensureNoNestedGroupMembers(projection);

  if (!hasAdmin(projection)) {
    throw new Error("Cannot remove the last group admin");
  }

  const groupKem = generateKemSeedAndKeyPair();
  const usersById = new Map(
    input.remainingUsers.map((user) => [user.userId, user]),
  );
  const remainingMembers = projection.filter(
    (member) => member.memberPrincipalType === "user",
  );
  const recipientUsers = remainingMembers.map((member) => {
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
    memberEnvelopes: {
      stateHash: "",
      envelopes: wrappedRecipients.map((envelope, index) =>
        toPrincipalMemberEnvelopeRequest({
          envelope,
          memberPrincipalType: "user",
          memberPrincipalId: recipientUsers[index]?.userId ?? "",
        }),
      ),
    },
  };
}

export async function createOrgManagerGroup(input: {
  readonly apiClient: OrgManagerPrincipalPolicyApi;
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
    execSql: input.execSql,
    groupId: group.groupId,
  });
  return group;
}

export async function addOrgManagerGroupUser(input: {
  readonly apiClient: OrgManagerPrincipalPolicyApi;
  readonly currentUserSecretKey: Uint8Array;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
  readonly targetUser: OrgManagerUserRecipient;
}): Promise<PrincipalPolicyBundleResponse> {
  const currentPolicy = await input.apiClient.getCurrentPrincipalPolicy(
    "group",
    input.groupId,
  );

  if (!currentPolicy) {
    throw new Error("Group policy could not be loaded");
  }

  const request = await buildAddGroupUserPolicyRequest({
    currentPolicy,
    currentUserSecretKey: input.currentUserSecretKey,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
    targetUser: input.targetUser,
  });
  const storedState = await input.apiClient.putPrincipalState(
    "group",
    input.groupId,
    request.state,
  );

  if (!storedState || typeof storedState !== "object") {
    throw new Error("Group policy update failed");
  }

  const stateHash = Reflect.get(storedState, "stateHash");
  if (typeof stateHash !== "string") {
    throw new Error("Group policy update did not return a state hash");
  }

  const storedEnvelopes = await input.apiClient.putPrincipalMemberEnvelopes(
    "group",
    input.groupId,
    {
      stateHash,
      envelopes: request.memberEnvelopes.envelopes,
    },
  );

  if (!storedEnvelopes) {
    throw new Error("Group member envelopes update failed");
  }

  return cacheGroupPolicy({
    apiClient: input.apiClient,
    execSql: input.execSql,
    groupId: input.groupId,
  });
}

export async function removeOrgManagerGroupUser(input: {
  readonly apiClient: OrgManagerPrincipalPolicyApi;
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly remainingUsers: ReadonlyArray<OrgManagerUserRecipient>;
  readonly removedUserId: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<PrincipalPolicyBundleResponse> {
  const currentPolicy = await input.apiClient.getCurrentPrincipalPolicy(
    "group",
    input.groupId,
  );

  if (!currentPolicy) {
    throw new Error("Group policy could not be loaded");
  }

  const request = await buildRemoveGroupUserPolicyRequest({
    currentPolicy,
    remainingUsers: input.remainingUsers,
    removedUserId: input.removedUserId,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const storedState = await input.apiClient.putPrincipalState(
    "group",
    input.groupId,
    request.state,
  );

  if (!storedState || typeof storedState !== "object") {
    throw new Error("Group policy update failed");
  }

  const stateHash = Reflect.get(storedState, "stateHash");
  if (typeof stateHash !== "string") {
    throw new Error("Group policy update did not return a state hash");
  }

  const storedEnvelopes = await input.apiClient.putPrincipalMemberEnvelopes(
    "group",
    input.groupId,
    {
      stateHash,
      envelopes: request.memberEnvelopes.envelopes,
    },
  );

  if (!storedEnvelopes) {
    throw new Error("Group member envelopes update failed");
  }

  return cacheGroupPolicy({
    apiClient: input.apiClient,
    execSql: input.execSql,
    groupId: input.groupId,
  });
}
