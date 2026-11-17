import {
  generateKemSeedAndKeyPair,
  normalizePrincipalProjectionMembers,
  toFingerprint,
  unwrapDek,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  PrincipalMemberEnvelopeRequest,
  PrincipalProjectionMemberRequest,
} from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { TrustedUserIdentity } from "../trustedUserIdentity";
import { principalSecretKeyMatchesState } from "./principalKeyValidation";
import {
  rewrapProjectionMemberEnvelopes,
  toRecipientEntries,
} from "./principalPolicyRecipients";

export type OrganizationDirectoryCurrentPolicy = Pick<
  PrincipalPolicyBundleResponse,
  "currentMemberEnvelopes" | "currentProjection" | "currentState"
>;

/** The key material a directory successor signs. */
export interface OrganizationDirectoryKeying {
  readonly encapsulationPublicKey: string;
  readonly keyEpoch: number;
  readonly keyFingerprint: string;
  readonly memberEnvelopes: PrincipalMemberEnvelopeRequest[];
}

function projectionMemberKey(member: PrincipalProjectionMemberRequest): string {
  return `${member.userId}\0${member.role}\0${member.identityBundleFingerprint}`;
}

function keptKeying(
  currentPolicy: OrganizationDirectoryCurrentPolicy,
  memberEnvelopes: PrincipalMemberEnvelopeRequest[],
): OrganizationDirectoryKeying {
  const { currentState } = currentPolicy;
  return {
    encapsulationPublicKey: currentState.encapsulationPublicKey,
    keyEpoch: currentState.keyEpoch,
    keyFingerprint: currentState.keyFingerprint,
    memberEnvelopes,
  };
}

/**
 * The organization secret the signer's own envelope opens, when it matches
 * the signed key. Null sends the successor through a rotation, which needs
 * no held secret and repairs any envelope that does not open to it.
 */
async function heldOrganizationSecret(input: {
  readonly currentPolicy: OrganizationDirectoryCurrentPolicy;
  readonly currentUserSecretKey: Uint8Array | null;
}): Promise<Uint8Array | null> {
  if (!input.currentUserSecretKey) return null;
  let secret: Uint8Array;
  try {
    secret = await unwrapDek(
      toRecipientEntries(input.currentPolicy.currentMemberEnvelopes.envelopes),
      input.currentUserSecretKey,
    );
  } catch {
    return null;
  }
  return (await principalSecretKeyMatchesState(
    secret,
    input.currentPolicy.currentState,
  ))
    ? secret
    : null;
}

async function rotatedKeying(input: {
  readonly currentPolicy: OrganizationDirectoryCurrentPolicy;
  readonly projection: ReadonlyArray<PrincipalProjectionMemberRequest>;
  readonly users: ReadonlyArray<TrustedUserIdentity>;
}): Promise<OrganizationDirectoryKeying> {
  const organizationKem = generateKemSeedAndKeyPair();
  return {
    encapsulationPublicKey: bytesToBase64(organizationKem.publicKey),
    keyEpoch: input.currentPolicy.currentState.keyEpoch + 1,
    keyFingerprint: await toFingerprint(organizationKem.publicKey),
    memberEnvelopes: await rewrapProjectionMemberEnvelopes({
      projection: input.projection,
      secretKey: organizationKem.secretKey,
      users: input.users,
    }),
  };
}

/**
 * Key material for the next organization directory state. An unchanged admin
 * projection keeps the key, epoch and envelopes; a projection that only adds
 * admins keeps the key and epoch and wraps the held secret for the added
 * admins alone. Any removal or changed member rotates to a fresh key wrapped
 * for every admin, so a removed admin never holds the successor's secret.
 */
export async function organizationDirectoryKeying(input: {
  readonly currentPolicy: OrganizationDirectoryCurrentPolicy;
  readonly currentUserSecretKey: Uint8Array | null;
  readonly projection: ReadonlyArray<PrincipalProjectionMemberRequest>;
  readonly users: ReadonlyArray<TrustedUserIdentity>;
}): Promise<OrganizationDirectoryKeying> {
  const previous = new Set(
    normalizePrincipalProjectionMembers(
      input.currentPolicy.currentProjection,
    ).map(projectionMemberKey),
  );
  const added = input.projection.filter(
    (member) => !previous.has(projectionMemberKey(member)),
  );
  const keepsEveryMember =
    input.projection.length - added.length === previous.size;
  if (!keepsEveryMember) return rotatedKeying(input);
  // The signed envelopes, re-served exactly as the predecessor holds them.
  const currentEnvelopes = [
    ...input.currentPolicy.currentMemberEnvelopes.envelopes,
  ];
  if (added.length === 0)
    return keptKeying(input.currentPolicy, currentEnvelopes);
  const secret = await heldOrganizationSecret(input);
  if (!secret) return rotatedKeying(input);
  return keptKeying(input.currentPolicy, [
    ...currentEnvelopes,
    ...(await rewrapProjectionMemberEnvelopes({
      projection: added,
      secretKey: secret,
      users: input.users,
    })),
  ]);
}
