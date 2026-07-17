export type ManagedRecipientPrincipalType = "group" | "organization";
export type PrincipalStateMemberType = "user" | "group";
export type PrincipalProjectionRole = "member" | "admin";
export type PrincipalStateMembershipMode = "projection";
export type PrincipalStatePayloadCipherSuite = "aes-256-gcm";

export interface PrincipalStateMember {
  principalType: PrincipalStateMemberType;
  principalId: string;
}

export interface PrincipalProjectionMember {
  memberPrincipalType: PrincipalStateMemberType;
  memberPrincipalId: string;
  role: PrincipalProjectionRole;
}

export interface PrincipalStateMemberEnvelope {
  memberPrincipalType: PrincipalStateMemberType;
  memberPrincipalId: string;
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
