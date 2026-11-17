import {
  buildPrincipalStateSigningInput,
  generateKemSeedAndKeyPair,
  type ReferencedPrincipalHead,
  type SigningKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { RegistrationRequest } from "@tearleads/validators/request";
import { encodeOrganizationAuthorityDescriptor } from "../principalContracts/organizationAuthorityDescriptor";
import { createPrincipalProjectionMember } from "../principalContracts/principalIdentityCommitments";

export async function buildInitialOrganizationPolicyRequest(input: {
  identityTrustDomain: string;
  adminGroupId: string;
  groupHeads: readonly ReferencedPrincipalHead[];
  encapsulationPublicKey: Uint8Array;
  memberGroupId: string;
  organizationId: string;
  signingKeyPair: SigningKeyPair;
  userId: string;
}): Promise<RegistrationRequest["initialOrganizationPolicy"]> {
  const organizationKem = generateKemSeedAndKeyPair();
  const signerUserKeyFingerprint = await toFingerprint(
    input.signingKeyPair.signingPublicKey,
  );
  const userEncapsulationKeyFingerprint = await toFingerprint(
    input.encapsulationPublicKey,
  );
  const projection = [
    await createPrincipalProjectionMember(
      {
        userId: input.userId,
        identityTrustDomain: input.identityTrustDomain,
        signingPublicKey: input.signingKeyPair.signingPublicKey,
        encapsulationPublicKey: input.encapsulationPublicKey,
      },
      "admin",
    ),
  ];
  const payloadCiphertext = encodeOrganizationAuthorityDescriptor({
    version: 2,
    organizationId: input.organizationId,
    adminGroupId: input.adminGroupId,
    memberGroupId: input.memberGroupId,
    groupHeads: input.groupHeads.map((head) => {
      if (head.principalType !== "group") {
        throw new Error("Organization directory can contain only group heads");
      }
      return { ...head, principalType: "group" };
    }),
  });
  const [memberEnvelope] = await wrapDekForRecipients(
    organizationKem.secretKey,
    [input.encapsulationPublicKey],
  );

  if (!memberEnvelope) {
    throw new Error("Failed to wrap organization key for registering user");
  }
  const memberEnvelopes = [
    {
      userId: input.userId,
      memberKeyFingerprint: userEncapsulationKeyFingerprint,
      kemCipherText: bytesToBase64(memberEnvelope.kemCipherText),
      wrappedKey: bytesToBase64(memberEnvelope.wrappedKey),
    },
  ];
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "organization",
      principalId: input.organizationId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(organizationKem.publicKey),
      keyFingerprint: await toFingerprint(organizationKem.publicKey),
      members: [{ userId: input.userId }],
      memberEnvelopes,
      projection,
      grants: [],
      payloadCiphertext,
      externalAuthority: null,
      signedAt: new Date().toISOString(),
      signerUserId: input.userId,
      signerUserKeyFingerprint,
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
    grants: [],
    memberEnvelopes,
  };
}
