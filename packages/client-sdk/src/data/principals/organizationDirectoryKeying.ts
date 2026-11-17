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
import { assertPrincipalIdentityCommitments } from "../principalContracts/principalIdentityCommitments";
import type { TrustedUserIdentity } from "../trustedUserIdentity";
import { principalSecretKeyMatchesState } from "./principalKeyValidation";
import {
  rewrapProjectionMemberEnvelopes,
  toRecipientEntries,
} from "./principalPolicyRecipients";

/** The predecessor fields the keep-or-rotate decision reads. */
export interface OrganizationDirectoryCurrentPolicy {
  readonly currentMemberEnvelopes: {
    readonly envelopes: readonly PrincipalMemberEnvelopeRequest[];
  };
  readonly currentProjection: readonly PrincipalProjectionMemberRequest[];
  readonly currentState: Pick<
    PrincipalPolicyBundleResponse["currentState"],
    "encapsulationPublicKey" | "keyEpoch" | "keyFingerprint"
  >;
}

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

/**
 * A growth wraps only the added admins, so the checks a full re-wrap runs
 * across the projection run here: every member's identity commitment, and no
 * added admin sharing an encapsulation key with a retained envelope.
 */
async function assertGrownRecipients(
  input: {
    readonly projection: ReadonlyArray<PrincipalProjectionMemberRequest>;
    readonly users: ReadonlyArray<TrustedUserIdentity>;
  },
  retained: readonly PrincipalMemberEnvelopeRequest[],
): Promise<void> {
  const users = new Map(input.users.map((user) => [user.userId, user]));
  await assertPrincipalIdentityCommitments({
    authenticated: false,
    projections: [input.projection],
    resolveTrustedUserIdentity: async (userId) => users.get(userId) ?? null,
  });
  const fingerprints = new Set(
    retained.map((envelope) => envelope.memberKeyFingerprint),
  );
  const retainedUsers = new Set(retained.map((envelope) => envelope.userId));
  for (const member of input.projection) {
    if (retainedUsers.has(member.userId)) continue;
    const user = users.get(member.userId);
    if (!user || fingerprints.has(user.encapsulationKeyFingerprint))
      throw new Error(
        "Organization directory recipients must not share an encapsulation key",
      );
  }
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
  // The predecessor's signed envelopes, re-served with only their signed
  // fields: a response may carry fields the request must not forward.
  const currentEnvelopes =
    input.currentPolicy.currentMemberEnvelopes.envelopes.map(
      (envelope): PrincipalMemberEnvelopeRequest => ({
        kemCipherText: envelope.kemCipherText,
        memberKeyFingerprint: envelope.memberKeyFingerprint,
        userId: envelope.userId,
        wrappedKey: envelope.wrappedKey,
      }),
    );
  // A key is kept only when the signer's own envelope opens it and it
  // matches the signed key. Otherwise, or without the signer's key, the write
  // rotates, which re-wraps a fresh key for every admin.
  const secret = await heldOrganizationSecret(input);
  if (!secret) return rotatedKeying(input);
  if (added.length === 0)
    return keptKeying(input.currentPolicy, currentEnvelopes);
  await assertGrownRecipients(input, currentEnvelopes);
  return keptKeying(input.currentPolicy, [
    ...currentEnvelopes,
    ...(await rewrapProjectionMemberEnvelopes({
      projection: added,
      secretKey: secret,
      users: input.users,
    })),
  ]);
}
