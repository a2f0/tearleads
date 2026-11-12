import {
  buildPrincipalStateSigningInput,
  computeUserIdentityBundleFingerprint,
  encodeBuiltinGroupMetadata,
  generateKemSeedAndKeyPair,
  type PrincipalContainerGrant,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { CreateOrganizationGroupRequest } from "@tearleads/validators/request";
import { API_TEST_IDENTITY_TRUST_DOMAIN } from "../policyProjection";
import { REGISTER_SIGNED_AT } from "./signing";

interface InitialGroupInput {
  identityTrustDomain?: string;
  encapsulationPublicKey: Uint8Array;
  grants?: readonly PrincipalContainerGrant[] | undefined;
  groupId?: string | undefined;
  signingPrivateKey: Uint8Array;
  signingPublicKey: Uint8Array;
  userId: string;
}

export async function createInitialAdminGroupRequest(
  input: InitialGroupInput,
): Promise<CreateOrganizationGroupRequest> {
  return createInitialBuiltinGroupRequest(input, "admins", "admin");
}

// Members holds the registering user alone; the Admins group is no longer a
// nested member.
export async function createInitialMemberGroupRequest(
  input: InitialGroupInput,
): Promise<CreateOrganizationGroupRequest> {
  return createInitialBuiltinGroupRequest(input, "members", "member");
}

async function createInitialBuiltinGroupRequest(
  input: InitialGroupInput,
  builtin: "admins" | "members",
  label: "admin" | "member",
): Promise<CreateOrganizationGroupRequest> {
  const groupId = input.groupId ?? crypto.randomUUID();
  const groupKem = generateKemSeedAndKeyPair();
  const projection = [
    {
      userId: input.userId,
      role: "admin" as const,
      identityBundleFingerprint: await computeUserIdentityBundleFingerprint({
        ...input,
        identityTrustDomain:
          input.identityTrustDomain ?? API_TEST_IDENTITY_TRUST_DOMAIN,
      }),
    },
  ];
  const payloadCiphertext = encodeBuiltinGroupMetadata(builtin);
  const [memberEnvelope] = await wrapDekForRecipients(groupKem.secretKey, [
    input.encapsulationPublicKey,
  ]);

  if (!memberEnvelope) {
    throw new Error(`Failed to wrap ${label} group key for test user`);
  }

  const memberEnvelopes = [
    {
      userId: input.userId,
      memberKeyFingerprint: await toFingerprint(input.encapsulationPublicKey),
      kemCipherText: bytesToBase64(memberEnvelope.kemCipherText),
      wrappedKey: bytesToBase64(memberEnvelope.wrappedKey),
    },
  ];
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: groupId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
      keyFingerprint: await toFingerprint(groupKem.publicKey),
      members: [{ userId: input.userId }],
      memberEnvelopes,
      projection,
      grants: [...(input.grants ?? [])],
      payloadCiphertext,
      externalAuthority: null,
      signedAt: REGISTER_SIGNED_AT,
      signerUserId: input.userId,
      signerUserKeyFingerprint: await toFingerprint(input.signingPublicKey),
    }),
    input.signingPrivateKey,
  );

  return {
    groupId,
    initialGroupPolicy: {
      state,
      encryptedPayload: {
        cipherSuite: "aes-256-gcm",
        ciphertext: payloadCiphertext,
        ciphertextHash: state.payloadCiphertextHash,
      },
      projection,
      grants: [...(input.grants ?? [])],
      memberEnvelopes,
    },
  };
}
