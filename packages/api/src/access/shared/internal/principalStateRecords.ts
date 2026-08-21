import {
  principalContainerGrantProjection,
  principalEpochKeys,
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
} from "@symcrypt/api-shared/schema";
import {
  type ManagedRecipientPrincipalType,
  normalizePrincipalContainerGrants,
  normalizePrincipalProjectionMembers,
  type PrincipalContainerGrant,
  type PrincipalContainerGrantAccessLevel,
  type PrincipalProjectionMember,
  type PrincipalProjectionRole,
  type PrincipalStateExternalAuthority,
  type PrincipalStateMemberEnvelope,
  type PrincipalStatePayloadCipherSuite,
  type SignedPrincipalState,
} from "@symcrypt/crypto";

export interface StoredPrincipalState extends SignedPrincipalState {
  stateHash: string;
  createdAt: Date;
}

export interface StoredPrincipalStatePayload {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  stateHash: string;
  cipherSuite: PrincipalStatePayloadCipherSuite;
  ciphertext: string;
  ciphertextHash: string;
  createdAt: Date;
}

export interface StoredPrincipalProjectionMember {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  stateHash: string;
  userId: string;
  role: PrincipalProjectionRole;
  createdAt: Date;
}

export interface StoredPrincipalContainerGrant extends PrincipalContainerGrant {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  stateHash: string;
  createdAt: Date;
}

export interface StoredPrincipalStateChainEntry {
  state: StoredPrincipalState;
  projection: StoredPrincipalProjectionMember[];
  grants: StoredPrincipalContainerGrant[];
}

export interface StoredPrincipalEpochKey {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  epoch: number;
  introducedByStateHash: string;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  createdAt: Date;
}

export interface PrincipalStatePayloadInput {
  cipherSuite: PrincipalStatePayloadCipherSuite;
  ciphertext: string;
  ciphertextHash: string;
}

export interface PrincipalStateBundleInput {
  state: SignedPrincipalState;
  encryptedPayload: PrincipalStatePayloadInput;
  projection: PrincipalProjectionMember[];
  grants: PrincipalContainerGrant[];
  memberEnvelopes: PrincipalStateMemberEnvelope[];
}

export interface PrincipalStateExternalSignerAuthorizationInput {
  currentState: StoredPrincipalState | null;
  normalizedInput: PrincipalStateBundleInput;
  previousProjection: StoredPrincipalProjectionMember[] | null;
  signerUserId: string;
}

export interface PrincipalStateReference {
  readonly principalType: ManagedRecipientPrincipalType;
  readonly principalId: string;
  readonly version: number;
  readonly keyEpoch: number;
  readonly stateHash: string;
  readonly keyFingerprint: string;
}

export const principalStateSelect = {
  principalType: principalStates.principalType,
  principalId: principalStates.principalId,
  version: principalStates.version,
  prevStateHash: principalStates.prevStateHash,
  keyEpoch: principalStates.keyEpoch,
  encapsulationPublicKey: principalStates.encapsulationPublicKey,
  keyFingerprint: principalStates.keyFingerprint,
  membershipMode: principalStates.membershipMode,
  membershipRoot: principalStates.membershipRoot,
  memberEnvelopesRoot: principalStates.memberEnvelopesRoot,
  projectionRoot: principalStates.projectionRoot,
  grantRoot: principalStates.grantRoot,
  payloadCiphertextHash: principalStates.payloadCiphertextHash,
  memberCount: principalStates.memberCount,
  grantCount: principalStates.grantCount,
  externalAuthority: principalStates.externalAuthority,
  signedAt: principalStates.signedAt,
  signerUserId: principalStates.signerUserId,
  signerUserKeyFingerprint: principalStates.signerUserKeyFingerprint,
  signature: principalStates.signature,
  stateHash: principalStates.stateHash,
  createdAt: principalStates.createdAt,
} as const;

export const principalEpochKeySelect = {
  principalType: principalEpochKeys.principalType,
  principalId: principalEpochKeys.principalId,
  epoch: principalEpochKeys.epoch,
  introducedByStateHash: principalEpochKeys.introducedByStateHash,
  encapsulationPublicKey: principalEpochKeys.encapsulationPublicKey,
  keyFingerprint: principalEpochKeys.keyFingerprint,
  createdAt: principalEpochKeys.createdAt,
} as const;

export const principalStatePayloadSelect = {
  principalType: principalStatePayloads.principalType,
  principalId: principalStatePayloads.principalId,
  stateHash: principalStatePayloads.stateHash,
  cipherSuite: principalStatePayloads.cipherSuite,
  ciphertext: principalStatePayloads.ciphertext,
  ciphertextHash: principalStatePayloads.ciphertextHash,
  createdAt: principalStatePayloads.createdAt,
} as const;

export const principalProjectionMemberSelect = {
  principalType: principalMembershipProjection.principalType,
  principalId: principalMembershipProjection.principalId,
  stateHash: principalMembershipProjection.stateHash,
  userId: principalMembershipProjection.userId,
  role: principalMembershipProjection.role,
  createdAt: principalMembershipProjection.createdAt,
} as const;

export const principalContainerGrantSelect = {
  principalType: principalContainerGrantProjection.principalType,
  principalId: principalContainerGrantProjection.principalId,
  stateHash: principalContainerGrantProjection.stateHash,
  containerId: principalContainerGrantProjection.containerId,
  accessLevel: principalContainerGrantProjection.accessLevel,
  createdAt: principalContainerGrantProjection.createdAt,
} as const;

interface PrincipalStateRow {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  version: number;
  prevStateHash: string | null;
  keyEpoch: number;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  membershipMode: "projection";
  membershipRoot: string;
  memberEnvelopesRoot: string;
  projectionRoot: string;
  grantRoot: string;
  payloadCiphertextHash: string;
  memberCount: number;
  grantCount: number;
  externalAuthority: PrincipalStateExternalAuthority | null;
  signedAt: Date;
  signerUserId: string;
  signerUserKeyFingerprint: string;
  signature: string;
  stateHash: string;
  createdAt: Date;
}

interface PrincipalProjectionMemberRow {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  stateHash: string;
  userId: string;
  role: PrincipalProjectionRole;
  createdAt: Date;
}

interface PrincipalContainerGrantRow {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  stateHash: string;
  containerId: string;
  accessLevel: PrincipalContainerGrantAccessLevel;
  createdAt: Date;
}

export function toStoredPrincipalState(
  row: PrincipalStateRow,
): StoredPrincipalState {
  return {
    principalType: row.principalType,
    principalId: row.principalId,
    version: row.version,
    prevStateHash: row.prevStateHash,
    keyEpoch: row.keyEpoch,
    encapsulationPublicKey: row.encapsulationPublicKey,
    keyFingerprint: row.keyFingerprint,
    membershipMode: row.membershipMode,
    membershipRoot: row.membershipRoot,
    memberEnvelopesRoot: row.memberEnvelopesRoot,
    projectionRoot: row.projectionRoot,
    grantRoot: row.grantRoot,
    payloadCiphertextHash: row.payloadCiphertextHash,
    memberCount: row.memberCount,
    grantCount: row.grantCount,
    externalAuthority: row.externalAuthority,
    signedAt: row.signedAt.toISOString(),
    signerUserId: row.signerUserId,
    signerUserKeyFingerprint: row.signerUserKeyFingerprint,
    signature: row.signature,
    stateHash: row.stateHash,
    createdAt: row.createdAt,
  };
}

export function toStoredPrincipalContainerGrant(
  row: PrincipalContainerGrantRow,
): StoredPrincipalContainerGrant {
  return { ...row };
}

export function toStoredProjectionMember(
  row: PrincipalProjectionMemberRow,
): StoredPrincipalProjectionMember {
  return {
    principalType: row.principalType,
    principalId: row.principalId,
    stateHash: row.stateHash,
    userId: row.userId,
    role: row.role,
    createdAt: row.createdAt,
  };
}

function stripSignedPrincipalStateArtifacts(
  state: SignedPrincipalState,
): SignedPrincipalState {
  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    prevStateHash: state.prevStateHash,
    keyEpoch: state.keyEpoch,
    encapsulationPublicKey: state.encapsulationPublicKey,
    keyFingerprint: state.keyFingerprint,
    membershipMode: state.membershipMode,
    membershipRoot: state.membershipRoot,
    memberEnvelopesRoot: state.memberEnvelopesRoot,
    projectionRoot: state.projectionRoot,
    grantRoot: state.grantRoot,
    payloadCiphertextHash: state.payloadCiphertextHash,
    memberCount: state.memberCount,
    grantCount: state.grantCount,
    externalAuthority: state.externalAuthority,
    signedAt: state.signedAt,
    signerUserId: state.signerUserId,
    signerUserKeyFingerprint: state.signerUserKeyFingerprint,
    signature: state.signature,
  };
}

export function normalizePrincipalStateWriteInput(
  input: PrincipalStateBundleInput,
): PrincipalStateBundleInput {
  return {
    state: stripSignedPrincipalStateArtifacts(input.state),
    encryptedPayload: {
      cipherSuite: input.encryptedPayload.cipherSuite,
      ciphertext: input.encryptedPayload.ciphertext,
      ciphertextHash: input.encryptedPayload.ciphertextHash,
    },
    projection: normalizePrincipalProjectionMembers(input.projection),
    grants: normalizePrincipalContainerGrants(input.grants),
    memberEnvelopes: input.memberEnvelopes.map((envelope) => ({
      userId: envelope.userId,
      memberKeyFingerprint: envelope.memberKeyFingerprint,
      kemCipherText: envelope.kemCipherText,
      wrappedKey: envelope.wrappedKey,
    })),
  };
}

export function projectionMemberKey(member: PrincipalProjectionMember): string {
  return `${member.userId}:${member.role}`;
}

export function principalStateProjectionKey(input: {
  readonly principalId: string;
  readonly stateHash: string;
}): string {
  return `${input.principalId}:${input.stateHash}`;
}

export function principalStateReferenceKey(input: {
  readonly principalType: ManagedRecipientPrincipalType;
  readonly principalId: string;
  readonly stateHash: string;
}): string {
  return `${input.principalType}:${input.principalId}:${input.stateHash}`;
}
