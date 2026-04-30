import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasObjectProperty,
  hasStringProperty,
  isUuidV4String,
} from "../util";

export interface PrincipalProjectionMemberRequest {
  memberPrincipalType: "user" | "group";
  memberPrincipalId: string;
  role: "member" | "admin";
}

export interface PrincipalStateRequest {
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
}

export interface PrincipalStateEncryptedPayloadRequest {
  cipherSuite: "aes-256-gcm";
  ciphertext: string;
  ciphertextHash: string;
}

export interface PutPrincipalStateRequest {
  state: PrincipalStateRequest;
  encryptedPayload: PrincipalStateEncryptedPayloadRequest;
  projection: PrincipalProjectionMemberRequest[];
}

export interface PrincipalMemberEnvelopeRequest {
  memberPrincipalType: "user" | "group";
  memberPrincipalId: string;
  memberKeyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
}

export interface PutPrincipalMemberEnvelopesRequest {
  stateHash: string;
  envelopes: PrincipalMemberEnvelopeRequest[];
}

function isManagedPrincipalType(
  value: string,
): value is PrincipalStateRequest["principalType"] {
  return value === "group" || value === "organization";
}

function isPrincipalStateMemberType(
  value: string,
): value is PrincipalProjectionMemberRequest["memberPrincipalType"] {
  return value === "user" || value === "group";
}

function isProjectionRole(
  value: string,
): value is PrincipalProjectionMemberRequest["role"] {
  return value === "member" || value === "admin";
}

export function isPrincipalProjectionMemberRequest(
  value: unknown,
): value is PrincipalProjectionMemberRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "memberPrincipalType") &&
    isPrincipalStateMemberType(value.memberPrincipalType) &&
    hasStringProperty(value, "memberPrincipalId") &&
    isUuidV4String(value.memberPrincipalId) &&
    hasStringProperty(value, "role") &&
    isProjectionRole(value.role)
  );
}

export function isPrincipalStateRequest(
  value: unknown,
): value is PrincipalStateRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "principalType") &&
    isManagedPrincipalType(value.principalType) &&
    hasStringProperty(value, "principalId") &&
    isUuidV4String(value.principalId) &&
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
    isUuidV4String(value.signerUserId) &&
    hasStringProperty(value, "signerUserKeyFingerprint") &&
    hasStringProperty(value, "signature")
  );
}

export function isPrincipalStateEncryptedPayloadRequest(
  value: unknown,
): value is PrincipalStateEncryptedPayloadRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "cipherSuite") &&
    value.cipherSuite === "aes-256-gcm" &&
    hasStringProperty(value, "ciphertext") &&
    hasStringProperty(value, "ciphertextHash")
  );
}

export function isPrincipalMemberEnvelopeRequest(
  value: unknown,
): value is PrincipalMemberEnvelopeRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "memberPrincipalType") &&
    isPrincipalStateMemberType(value.memberPrincipalType) &&
    hasStringProperty(value, "memberPrincipalId") &&
    isUuidV4String(value.memberPrincipalId) &&
    hasStringProperty(value, "memberKeyFingerprint") &&
    hasStringProperty(value, "kemCipherText") &&
    hasStringProperty(value, "wrappedKey")
  );
}

export function isPutPrincipalStateRequest(
  value: unknown,
): value is PutPrincipalStateRequest {
  return (
    isPlainObject(value) &&
    hasObjectProperty(value, "state") &&
    isPrincipalStateRequest(value.state) &&
    hasObjectProperty(value, "encryptedPayload") &&
    isPrincipalStateEncryptedPayloadRequest(value.encryptedPayload) &&
    hasArrayProperty(value, "projection") &&
    value.projection.every(isPrincipalProjectionMemberRequest)
  );
}

export function isPutPrincipalMemberEnvelopesRequest(
  value: unknown,
): value is PutPrincipalMemberEnvelopesRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "stateHash") &&
    hasArrayProperty(value, "envelopes") &&
    value.envelopes.every(isPrincipalMemberEnvelopeRequest)
  );
}
