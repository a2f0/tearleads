import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasObjectProperty,
  hasStringProperty,
} from "../util";

export interface PrincipalStateResponse {
  principalType: "group" | "organization";
  principalId: string;
  version: number;
  prevStateHash: string | null;
  keyEpoch: number;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  membershipMode: "projection";
  membershipRoot: string;
  projectionRoot: string;
  payloadCiphertextHash: string;
  memberCount: number;
  signedAt: string;
  signerUserId: string;
  signerUserKeyFingerprint: string;
  signature: string;
  stateHash: string;
  createdAt: string;
}

export interface PrincipalProjectionMemberResponse {
  memberPrincipalType: "user" | "group";
  memberPrincipalId: string;
  role: "member" | "admin";
}

export interface PrincipalStatePayloadResponse {
  principalType: "group" | "organization";
  principalId: string;
  stateHash: string;
  cipherSuite: "aes-256-gcm";
  ciphertext: string;
  ciphertextHash: string;
  createdAt: string;
}

export interface PrincipalMemberEnvelopeResponse {
  memberPrincipalType: "user" | "group";
  memberPrincipalId: string;
  memberKeyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
}

export interface CurrentPrincipalMemberEnvelopesResponse {
  principalType: "group" | "organization";
  principalId: string;
  stateHash: string;
  epoch: number;
  envelopes: PrincipalMemberEnvelopeResponse[];
}

export interface ReferencedPrincipalStateResponse {
  principalType: "group" | "organization";
  principalId: string;
  version: number;
  keyEpoch: number;
  stateHash: string;
}

export interface PrincipalPolicyStateChainEntryResponse {
  state: PrincipalStateResponse;
  projection: PrincipalProjectionMemberResponse[];
}

export interface PrincipalPolicyBundleResponse {
  currentState: PrincipalStateResponse;
  currentPayload: PrincipalStatePayloadResponse;
  currentProjection: PrincipalProjectionMemberResponse[];
  currentMemberEnvelopes: CurrentPrincipalMemberEnvelopesResponse;
  previousStates: PrincipalPolicyStateChainEntryResponse[];
}

function isManagedPrincipalType(
  value: string,
): value is PrincipalStateResponse["principalType"] {
  return value === "group" || value === "organization";
}

function isPrincipalStateMemberType(
  value: string,
): value is PrincipalMemberEnvelopeResponse["memberPrincipalType"] {
  return value === "user" || value === "group";
}

function isProjectionRole(
  value: string,
): value is PrincipalProjectionMemberResponse["role"] {
  return value === "member" || value === "admin";
}

function isPrincipalProjectionMemberResponse(
  value: unknown,
): value is PrincipalProjectionMemberResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "memberPrincipalType") &&
    isPrincipalStateMemberType(value.memberPrincipalType) &&
    hasStringProperty(value, "memberPrincipalId") &&
    hasStringProperty(value, "role") &&
    isProjectionRole(value.role)
  );
}

function isPrincipalMemberEnvelopeResponse(
  value: unknown,
): value is PrincipalMemberEnvelopeResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "memberPrincipalType") &&
    isPrincipalStateMemberType(value.memberPrincipalType) &&
    hasStringProperty(value, "memberPrincipalId") &&
    hasStringProperty(value, "memberKeyFingerprint") &&
    hasStringProperty(value, "kemCipherText") &&
    hasStringProperty(value, "wrappedKey")
  );
}

export function isPrincipalStateResponse(
  value: unknown,
): value is PrincipalStateResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "principalType") &&
    isManagedPrincipalType(value.principalType) &&
    hasStringProperty(value, "principalId") &&
    hasNumberProperty(value, "version") &&
    hasNullableStringProperty(value, "prevStateHash") &&
    hasNumberProperty(value, "keyEpoch") &&
    hasStringProperty(value, "encapsulationPublicKey") &&
    hasStringProperty(value, "keyFingerprint") &&
    hasStringProperty(value, "membershipMode") &&
    value.membershipMode === "projection" &&
    hasStringProperty(value, "membershipRoot") &&
    hasStringProperty(value, "projectionRoot") &&
    hasStringProperty(value, "payloadCiphertextHash") &&
    hasNumberProperty(value, "memberCount") &&
    Number.isInteger(value.memberCount) &&
    value.memberCount >= 0 &&
    hasStringProperty(value, "signedAt") &&
    hasStringProperty(value, "signerUserId") &&
    hasStringProperty(value, "signerUserKeyFingerprint") &&
    hasStringProperty(value, "signature") &&
    hasStringProperty(value, "stateHash") &&
    hasStringProperty(value, "createdAt")
  );
}

export function isPrincipalStatePayloadResponse(
  value: unknown,
): value is PrincipalStatePayloadResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "principalType") &&
    isManagedPrincipalType(value.principalType) &&
    hasStringProperty(value, "principalId") &&
    hasStringProperty(value, "stateHash") &&
    hasStringProperty(value, "cipherSuite") &&
    value.cipherSuite === "aes-256-gcm" &&
    hasStringProperty(value, "ciphertext") &&
    hasStringProperty(value, "ciphertextHash") &&
    hasStringProperty(value, "createdAt")
  );
}

export function isCurrentPrincipalMemberEnvelopesResponse(
  value: unknown,
): value is CurrentPrincipalMemberEnvelopesResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "principalType") &&
    isManagedPrincipalType(value.principalType) &&
    hasStringProperty(value, "principalId") &&
    hasStringProperty(value, "stateHash") &&
    hasNumberProperty(value, "epoch") &&
    hasArrayProperty(value, "envelopes") &&
    value.envelopes.every(isPrincipalMemberEnvelopeResponse)
  );
}

export function isReferencedPrincipalStateResponse(
  value: unknown,
): value is ReferencedPrincipalStateResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "principalType") &&
    isManagedPrincipalType(value.principalType) &&
    hasStringProperty(value, "principalId") &&
    hasNumberProperty(value, "version") &&
    hasNumberProperty(value, "keyEpoch") &&
    hasStringProperty(value, "stateHash")
  );
}

export function isPrincipalPolicyStateChainEntryResponse(
  value: unknown,
): value is PrincipalPolicyStateChainEntryResponse {
  return (
    isPlainObject(value) &&
    hasObjectProperty(value, "state") &&
    isPrincipalStateResponse(value.state) &&
    hasArrayProperty(value, "projection") &&
    value.projection.every(isPrincipalProjectionMemberResponse)
  );
}

export function isPrincipalPolicyBundleResponse(
  value: unknown,
): value is PrincipalPolicyBundleResponse {
  return (
    isPlainObject(value) &&
    hasObjectProperty(value, "currentState") &&
    isPrincipalStateResponse(value.currentState) &&
    hasObjectProperty(value, "currentPayload") &&
    isPrincipalStatePayloadResponse(value.currentPayload) &&
    hasArrayProperty(value, "currentProjection") &&
    value.currentProjection.every(isPrincipalProjectionMemberResponse) &&
    hasObjectProperty(value, "currentMemberEnvelopes") &&
    isCurrentPrincipalMemberEnvelopesResponse(value.currentMemberEnvelopes) &&
    hasArrayProperty(value, "previousStates") &&
    value.previousStates.every(isPrincipalPolicyStateChainEntryResponse)
  );
}
