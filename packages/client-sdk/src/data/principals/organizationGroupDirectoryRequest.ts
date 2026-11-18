import {
  buildPrincipalStateSigningInput,
  normalizePrincipalProjectionMembers,
  type ReferencedPrincipalHead,
  type SigningKeyPair,
  signPrincipalState,
} from "@tearleads/crypto";
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
import {
  type OrganizationDirectoryCurrentPolicy,
  organizationDirectoryKeying,
} from "./organizationDirectoryKeying";

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

/**
 * The organization's successor directory state. Its key follows the Admins
 * projection (see `organizationDirectoryKeying`): `currentUserSecretKey` is
 * the signer's KEM secret, needed only to keep the key while admins grow;
 * without it a growth rotates.
 */
export async function buildOrganizationGroupDirectoryPolicyRequest(input: {
  readonly adminProjection: readonly PrincipalProjectionMemberRequest[];
  readonly adminUsers: readonly TrustedUserIdentity[];
  readonly currentPolicy: OrganizationDirectoryCurrentPolicy &
    Pick<PrincipalPolicyBundleResponse, "currentState">;
  readonly currentUserSecretKey: Uint8Array | null;
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
  const keying = await organizationDirectoryKeying({
    currentPolicy: input.currentPolicy,
    currentUserSecretKey: input.currentUserSecretKey,
    projection,
    signerUserId: input.signerUserId,
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
      keyEpoch: keying.keyEpoch,
      encapsulationPublicKey: keying.encapsulationPublicKey,
      keyFingerprint: keying.keyFingerprint,
      members: projection.map((member) => ({ userId: member.userId })),
      memberEnvelopes: keying.memberEnvelopes,
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
      ciphertext: payloadCiphertext,
    },
    grants: [],
    memberEnvelopes: keying.memberEnvelopes,
    projection,
    state,
  };
}
