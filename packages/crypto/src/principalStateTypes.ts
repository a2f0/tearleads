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
  projectionRoot: string;
  payloadCiphertextHash: string;
  memberCount: number;
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
  projection: PrincipalProjectionMember[];
  payloadCiphertext: string;
  signedAt: string;
  signerUserId: string;
  signerUserKeyFingerprint: string;
}

export interface SignedPrincipalState extends UnsignedPrincipalState {
  signature: string;
}
