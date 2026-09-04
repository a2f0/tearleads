import {
  generateKemSeedAndKeyPair,
  type PrincipalPolicyExternalAuthority,
  toFingerprint,
  unwrapDek,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  PrincipalContainerGrantRequest,
  PrincipalProjectionMemberRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type { TrustedUserIdentity } from "../../data/trustedUserIdentity";
import {
  isDirectGroupAdmin,
  requireSignerCanManageGroup,
} from "./groupMutationAuthorization";
import type { BuildGroupMembershipMutationInput } from "./groupPolicyMutationContext";
import { verifyGroupPolicy } from "./groupPolicyVerification";
import {
  rewrapProjectionMemberEnvelopes,
  toRecipientEntries,
} from "./principalPolicyRecipients";
import {
  readGroupPolicyPayloadName,
  signedGroupPolicyRequest,
  userProjectionMember,
} from "./principalPolicyRequest";

type BuildAddGroupUserPolicyInput = BuildGroupMembershipMutationInput & {
  readonly currentUsers: ReadonlyArray<TrustedUserIdentity>;
  readonly currentUserSecretKey: Uint8Array;
  readonly targetUser: TrustedUserIdentity;
};

function hasAdmin(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): boolean {
  return projection.some((member) => member.role === "admin");
}

function requireExternalAuthority(
  authority: PrincipalPolicyExternalAuthority | undefined,
): PrincipalPolicyExternalAuthority {
  if (!authority) {
    throw new Error("External principal authority could not be verified");
  }
  return authority;
}

async function verifyAndAuthorizeGroupMutation(
  input: BuildGroupMembershipMutationInput,
): Promise<void> {
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
}

async function buildRotatedKeyGroupPolicyRequest(
  input: BuildGroupMembershipMutationInput,
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
  users: ReadonlyArray<TrustedUserIdentity>,
  grants = input.currentPolicy.currentGrants,
): Promise<PutPrincipalPolicyRequest> {
  const groupKem = generateKemSeedAndKeyPair();
  const memberEnvelopes = await rewrapProjectionMemberEnvelopes({
    projection,
    secretKey: groupKem.secretKey,
    users,
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
    grants,
    memberEnvelopes,
    name: readGroupPolicyPayloadName(input.currentPolicy),
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
): Promise<PutPrincipalPolicyRequest> {
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
      (envelope) => envelope.userId !== targetKey,
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
    grants: input.currentPolicy.currentGrants,
    memberEnvelopes,
    name: readGroupPolicyPayloadName(input.currentPolicy),
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
): Promise<PutPrincipalPolicyRequest> {
  await verifyAndAuthorizeGroupMutation(input);

  const targetKey = input.targetUser.userId;
  const currentProjection = input.currentPolicy.currentProjection;
  if (currentProjection.some((member) => member.userId === targetKey)) {
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
    : buildRotatedKeyGroupPolicyRequest(input, projection, [
        ...input.currentUsers,
        input.targetUser,
      ]);
}

export async function buildRemoveGroupUserPolicyRequest(
  input: BuildGroupMembershipMutationInput & {
    readonly remainingUsers: ReadonlyArray<TrustedUserIdentity>;
    readonly removedUserId: string;
  },
): Promise<PutPrincipalPolicyRequest> {
  await verifyAndAuthorizeGroupMutation(input);

  const key = input.removedUserId;
  const projection = input.currentPolicy.currentProjection.filter(
    (member) => member.userId !== key,
  );

  if (projection.length === input.currentPolicy.currentProjection.length) {
    throw new Error("User is not a group member");
  }

  if (
    hasAdmin(input.currentPolicy.currentProjection) &&
    !hasAdmin(projection)
  ) {
    throw new Error("Cannot remove the last group admin");
  }

  return buildRotatedKeyGroupPolicyRequest(
    input,
    projection,
    input.remainingUsers,
  );
}

export async function buildGroupAccessSetShrinkPolicyRequest(
  input: BuildGroupMembershipMutationInput & {
    readonly currentUsers: ReadonlyArray<TrustedUserIdentity>;
    readonly revokedContainerId: string;
  },
): Promise<PutPrincipalPolicyRequest> {
  await verifyAndAuthorizeGroupMutation(input);

  return buildRotatedKeyGroupPolicyRequest(
    input,
    [...input.currentPolicy.currentProjection],
    input.currentUsers,
    input.currentPolicy.currentGrants.filter(
      (grant) => grant.containerId !== input.revokedContainerId,
    ),
  );
}

/** Signs a complete successor grant projection without rotating group key material. */
export async function buildSetGroupContainerGrantPolicyRequest(
  input: BuildGroupMembershipMutationInput & {
    readonly accessLevel: PrincipalContainerGrantRequest["accessLevel"];
    readonly containerId: string;
  },
): Promise<PutPrincipalPolicyRequest> {
  await verifyAndAuthorizeGroupMutation(input);
  const grants = [
    ...input.currentPolicy.currentGrants.filter(
      (grant) => grant.containerId !== input.containerId,
    ),
    { accessLevel: input.accessLevel, containerId: input.containerId },
  ];
  return signedGroupPolicyRequest({
    currentPolicy: input.currentPolicy,
    encapsulationPublicKey:
      input.currentPolicy.currentState.encapsulationPublicKey,
    externalAuthority: isDirectGroupAdmin(
      input.currentPolicy,
      input.signerUserId,
    )
      ? null
      : requireExternalAuthority(input.externalAuthority).currentHead,
    keyEpoch: input.currentPolicy.currentState.keyEpoch,
    keyFingerprint: input.currentPolicy.currentState.keyFingerprint,
    grants,
    memberEnvelopes: input.currentPolicy.currentMemberEnvelopes.envelopes,
    name: readGroupPolicyPayloadName(input.currentPolicy),
    principalId: input.currentPolicy.currentState.principalId,
    projection: input.currentPolicy.currentProjection,
    signedAt: new Date().toISOString(),
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
}
