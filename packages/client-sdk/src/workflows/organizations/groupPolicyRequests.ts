import {
  generateKemSeedAndKeyPair,
  type PrincipalPolicyExternalAuthority,
  toFingerprint,
  unwrapDek,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
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
import { hasAdmin } from "./principalPolicyProjection";
import {
  rewrapProjectionMemberEnvelopes,
  toPrincipalMemberEnvelopeRequest,
  toRecipientEntries,
} from "./principalPolicyRecipients";
import {
  signedGroupPolicyRequest,
  userProjectionMember,
} from "./principalPolicyRequest";

type BuildAddGroupUserPolicyInput = BuildGroupMembershipMutationInput & {
  readonly currentUsers: ReadonlyArray<TrustedUserIdentity>;
  readonly currentUserSecretKey: Uint8Array;
  readonly targetUser: TrustedUserIdentity;
};

function requireExternalAuthority(
  authority: PrincipalPolicyExternalAuthority | undefined,
): PrincipalPolicyExternalAuthority {
  if (!authority) {
    throw new Error("External principal authority could not be verified");
  }
  return authority;
}

async function buildOrgAdminAddGroupUserPolicyRequest(
  input: BuildAddGroupUserPolicyInput,
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): Promise<PutPrincipalPolicyRequest> {
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
): Promise<PutPrincipalPolicyRequest> {
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
    : buildOrgAdminAddGroupUserPolicyRequest(input, projection);
}

export async function buildRemoveGroupUserPolicyRequest(
  input: BuildGroupMembershipMutationInput & {
    readonly remainingUsers: ReadonlyArray<TrustedUserIdentity>;
    readonly removedUserId: string;
  },
): Promise<PutPrincipalPolicyRequest> {
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
): Promise<PutPrincipalPolicyRequest> {
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
