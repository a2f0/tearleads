import {
  buildPrincipalStateSigningInput,
  generateKemSeedAndKeyPair,
  normalizePrincipalProjectionMembers,
  type ReferencedPrincipalHead,
  type SigningKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  PrincipalProjectionMemberRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  encodeOrganizationAuthorityDescriptor,
  normalizeOrganizationGroupHeads,
  type OrganizationAuthorityDescriptor,
  type OrganizationGroupHead,
} from "../principalContracts/organizationAuthorityDescriptor";
import type { TrustedUserIdentity } from "../trustedUserIdentity";
import { rewrapProjectionMemberEnvelopes } from "./principalPolicyRecipients";

export function organizationGroupHead(
  head: ReferencedPrincipalHead,
): OrganizationGroupHead {
  if (head.principalType !== "group") {
    throw new Error("Organization directory can contain only group heads");
  }
  return { ...head, principalType: "group" };
}

export function replaceOrganizationGroupHead(input: {
  readonly descriptor: OrganizationAuthorityDescriptor;
  readonly nextHead: ReferencedPrincipalHead;
}): OrganizationGroupHead[] {
  const nextHead = organizationGroupHead(input.nextHead);
  return normalizeOrganizationGroupHeads([
    ...input.descriptor.groupHeads.filter(
      (head) => head.principalId !== nextHead.principalId,
    ),
    nextHead,
  ]);
}

export async function buildOrganizationGroupDirectoryPolicyRequest(input: {
  readonly adminProjection: readonly PrincipalProjectionMemberRequest[];
  readonly adminUsers: readonly TrustedUserIdentity[];
  readonly currentPolicy: Pick<PrincipalPolicyBundleResponse, "currentState">;
  readonly descriptor: OrganizationAuthorityDescriptor;
  readonly groupHeads: readonly OrganizationGroupHead[];
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
}): Promise<PutPrincipalPolicyRequest> {
  const projection = normalizePrincipalProjectionMembers(input.adminProjection);
  if (
    projection.length === 0 ||
    projection.some((member) => member.role !== "admin")
  ) {
    throw new Error("Organization policy must mirror the Admins projection");
  }
  const organizationKem = generateKemSeedAndKeyPair();
  const memberEnvelopes = await rewrapProjectionMemberEnvelopes({
    projection,
    secretKey: organizationKem.secretKey,
    users: input.adminUsers,
  });
  const payloadCiphertext = encodeOrganizationAuthorityDescriptor({
    ...input.descriptor,
    groupHeads: input.groupHeads,
  });
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "organization",
      principalId: input.descriptor.organizationId,
      version: input.currentPolicy.currentState.version + 1,
      prevStateHash: input.currentPolicy.currentState.stateHash,
      keyEpoch: input.currentPolicy.currentState.keyEpoch + 1,
      encapsulationPublicKey: bytesToBase64(organizationKem.publicKey),
      keyFingerprint: await toFingerprint(organizationKem.publicKey),
      members: projection.map((member) => ({ userId: member.userId })),
      memberEnvelopes,
      projection,
      grants: [],
      payloadCiphertext,
      externalAuthority: null,
      signedAt: new Date().toISOString(),
      signerUserId: input.signerUserId,
      signerUserKeyFingerprint: input.signingFingerprint,
    }),
    input.signingKeyPair.signingPrivateKey,
  );

  return {
    encryptedPayload: {
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: state.payloadCiphertextHash,
    },
    grants: [],
    memberEnvelopes,
    projection,
    state,
  };
}
