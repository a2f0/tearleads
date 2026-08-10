import {
  buildPrincipalStateSigningInput,
  type EncapsulationKeyPair,
  generateKemSeedAndKeyPair,
  normalizePrincipalProjectionMembers,
  type PrincipalPolicyExternalAuthority,
  type SigningKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  CreateOrganizationGroupRequest,
  PrincipalMemberEnvelopeRequest,
  PrincipalProjectionMemberRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";

interface BuildInitialGroupPolicyInput {
  readonly creatorEncapsulationKeyPair: EncapsulationKeyPair;
  readonly externalAuthority?:
    | PrincipalPolicyExternalAuthority["currentHead"]
    | null;
  readonly groupId: string;
  readonly includeSignerAsAdmin?: boolean;
  readonly name: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}

export function userProjectionMember(
  userId: string,
  role: "member" | "admin",
): PrincipalProjectionMemberRequest {
  return { userId: userId, role };
}

function projectionToStateMembers(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
) {
  return projection.map((member) => ({ userId: member.userId }));
}

function payloadCiphertextForProjection(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): string {
  return bytesToBase64(
    new TextEncoder().encode(JSON.stringify({ members: projection })),
  );
}

export async function signedGroupPolicyRequest(input: {
  readonly currentPolicy?: PrincipalPolicyBundleResponse;
  readonly encapsulationPublicKey: string;
  readonly externalAuthority:
    | PrincipalPolicyExternalAuthority["currentHead"]
    | null;
  readonly keyEpoch: number;
  readonly keyFingerprint: string;
  readonly memberEnvelopes: ReadonlyArray<PrincipalMemberEnvelopeRequest>;
  readonly principalId: string;
  readonly projection: ReadonlyArray<PrincipalProjectionMemberRequest>;
  readonly signedAt: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<PutPrincipalPolicyRequest> {
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
      memberEnvelopes: [...input.memberEnvelopes],
      projection,
      payloadCiphertext,
      externalAuthority: input.externalAuthority,
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
    memberEnvelopes: [...input.memberEnvelopes],
  };
}

export async function buildInitialGroupPolicyRequest(
  input: BuildInitialGroupPolicyInput,
): Promise<CreateOrganizationGroupRequest> {
  const groupKem = generateKemSeedAndKeyPair();
  const withSigner = input.includeSignerAsAdmin ?? true;
  const projection = withSigner
    ? [userProjectionMember(input.signerUserId, "admin")]
    : [];
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
      userId: input.signerUserId,
      memberKeyFingerprint: creatorFingerprint,
      kemCipherText: bytesToBase64(creatorEnvelope.kemCipherText),
      wrappedKey: bytesToBase64(creatorEnvelope.wrappedKey),
    });
  }
  const policyRequest = await signedGroupPolicyRequest({
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    externalAuthority: input.externalAuthority ?? null,
    keyEpoch: 1,
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    memberEnvelopes,
    principalId: input.groupId,
    projection,
    signedAt: new Date().toISOString(),
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });

  return {
    groupId: input.groupId,
    name: input.name.trim(),
    initialGroupPolicy: policyRequest,
  };
}

/**
 * Members at bootstrap holds the registering user alone.
 *
 * It used to also contain the Admins group as a nested member, so that admins
 * were implicitly members. Principals contain only users now, so an admin is an
 * ordinary Members entry — and bootstrap has exactly one user, who is that
 * admin.
 */
export async function buildInitialMemberGroupPolicyRequest(input: {
  readonly creatorEncapsulationKeyPair: EncapsulationKeyPair;
  readonly groupId: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<CreateOrganizationGroupRequest> {
  return buildInitialGroupPolicyRequest({ ...input, name: "Members" });
}
