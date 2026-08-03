export type ManagedRecipientPrincipalType = "group" | "organization";
export type PrincipalProjectionRole = "member" | "admin";
export type PrincipalStateMembershipMode = "projection";
export type PrincipalStatePayloadCipherSuite = "aes-256-gcm";

/**
 * Principals contain users only — never other groups.
 *
 * Group nesting was removed deliberately. It was the sole source of unbounded
 * cost when a principal rotates: re-wrapping a containing group's member
 * envelope changes that group's `memberEnvelopesRoot`, which is inside its
 * SIGNED state, so the container needs a new state — and so does anything
 * containing it, with no depth limit. Removing one member from a deeply nested
 * group therefore had no bounded cost.
 *
 * The member type is gone rather than pinned to `"user"`: a field that can only
 * hold one value still has to be encoded, hashed, stored, and read everywhere,
 * and it invites the branch back. Membership is now a set of user ids, and
 * reachability is a lookup rather than a graph walk.
 */
export interface PrincipalStateMember {
  userId: string;
}

export interface PrincipalProjectionMember {
  userId: string;
  role: PrincipalProjectionRole;
}

export interface PrincipalStateMemberEnvelope {
  userId: string;
  memberKeyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
}

/**
 * Exact signed head of the external principal policy that authorized a state.
 * Organization-scoped group policies use the reserved Admins group here.
 */
export interface PrincipalStateExternalAuthority {
  principalType: "group";
  principalId: string;
  version: number;
  keyEpoch: number;
  stateHash: string;
  keyFingerprint: string;
}

export interface UnsignedPrincipalState {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  version: number;
  prevStateHash: string | null;
  keyEpoch: number;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  membershipMode: PrincipalStateMembershipMode;
  membershipRoot: string;
  memberEnvelopesRoot: string;
  projectionRoot: string;
  payloadCiphertextHash: string;
  memberCount: number;
  externalAuthority: PrincipalStateExternalAuthority | null;
  signedAt: string;
  signerUserId: string;
  signerUserKeyFingerprint: string;
}

export type PrincipalStateSigningInput = UnsignedPrincipalState;

export interface PrincipalStateHeaderInput {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  version: number;
  prevStateHash: string | null;
  keyEpoch: number;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  members: PrincipalStateMember[];
  memberEnvelopes: PrincipalStateMemberEnvelope[];
  projection: PrincipalProjectionMember[];
  payloadCiphertext: string;
  externalAuthority: PrincipalStateExternalAuthority | null;
  signedAt: string;
  signerUserId: string;
  signerUserKeyFingerprint: string;
}

export interface SignedPrincipalState extends UnsignedPrincipalState {
  signature: string;
}
