import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasObjectProperty,
  hasStringProperty,
  isUuidV4String,
  MAX_PRINCIPAL_STATE_VERSION,
} from "../util";

export interface PrincipalProjectionMemberRequest {
  userId: string;
  role: "member" | "admin";
}

export interface PrincipalStateExternalAuthorityRequest {
  principalType: "group";
  principalId: string;
  version: number;
  keyEpoch: number;
  stateHash: string;
  keyFingerprint: string;
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
  memberEnvelopesRoot: string;
  projectionRoot: string;
  payloadCiphertextHash: string;
  memberCount: number;
  externalAuthority: PrincipalStateExternalAuthorityRequest | null;
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

export interface PutPrincipalPolicyRequest {
  state: PrincipalStateRequest;
  encryptedPayload: PrincipalStateEncryptedPayloadRequest;
  projection: PrincipalProjectionMemberRequest[];
  memberEnvelopes: PrincipalMemberEnvelopeRequest[];
}

export interface PrincipalMemberEnvelopeRequest {
  userId: string;
  memberKeyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
}

function isManagedPrincipalType(
  value: string,
): value is PrincipalStateRequest["principalType"] {
  return value === "group" || value === "organization";
}

function isProjectionRole(
  value: string,
): value is PrincipalProjectionMemberRequest["role"] {
  return value === "member" || value === "admin";
}

function isPrincipalProjectionMemberRequest(
  value: unknown,
): value is PrincipalProjectionMemberRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "userId") &&
    isUuidV4String(value.userId) &&
    hasStringProperty(value, "role") &&
    isProjectionRole(value.role)
  );
}

function isPrincipalStateRequest(
  value: unknown,
): value is PrincipalStateRequest {
  const externalAuthority = isPlainObject(value)
    ? Reflect.get(value, "externalAuthority")
    : undefined;
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "principalType") &&
    isManagedPrincipalType(value.principalType) &&
    hasStringProperty(value, "principalId") &&
    isUuidV4String(value.principalId) &&
    hasNumberProperty(value, "version") &&
    Number.isInteger(value.version) &&
    value.version > 0 &&
    // Rejected at the request boundary so an out-of-domain version is a 400,
    // not a 500 from the crypto layer's own check further in. The bound exists
    // because a recovery walk must be able to page back through the whole
    // chain; see MAX_PRINCIPAL_STATE_VERSION.
    value.version <= MAX_PRINCIPAL_STATE_VERSION &&
    hasNullableStringProperty(value, "prevStateHash") &&
    hasNumberProperty(value, "keyEpoch") &&
    hasStringProperty(value, "encapsulationPublicKey") &&
    hasStringProperty(value, "keyFingerprint") &&
    hasStringProperty(value, "membershipMode") &&
    value.membershipMode === "projection" &&
    hasStringProperty(value, "membershipRoot") &&
    hasStringProperty(value, "memberEnvelopesRoot") &&
    hasStringProperty(value, "projectionRoot") &&
    hasStringProperty(value, "payloadCiphertextHash") &&
    hasNumberProperty(value, "memberCount") &&
    Number.isInteger(value.memberCount) &&
    value.memberCount >= 0 &&
    (externalAuthority === null ||
      (isPlainObject(externalAuthority) &&
        hasStringProperty(externalAuthority, "principalType") &&
        externalAuthority.principalType === "group" &&
        hasStringProperty(externalAuthority, "principalId") &&
        isUuidV4String(externalAuthority.principalId) &&
        hasNumberProperty(externalAuthority, "version") &&
        Number.isInteger(externalAuthority.version) &&
        externalAuthority.version > 0 &&
        hasNumberProperty(externalAuthority, "keyEpoch") &&
        Number.isInteger(externalAuthority.keyEpoch) &&
        externalAuthority.keyEpoch > 0 &&
        hasStringProperty(externalAuthority, "stateHash") &&
        hasStringProperty(externalAuthority, "keyFingerprint"))) &&
    hasStringProperty(value, "signedAt") &&
    hasStringProperty(value, "signerUserId") &&
    isUuidV4String(value.signerUserId) &&
    hasStringProperty(value, "signerUserKeyFingerprint") &&
    hasStringProperty(value, "signature")
  );
}

function isPrincipalStateEncryptedPayloadRequest(
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

function isPrincipalMemberEnvelopeRequest(
  value: unknown,
): value is PrincipalMemberEnvelopeRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "userId") &&
    isUuidV4String(value.userId) &&
    hasStringProperty(value, "memberKeyFingerprint") &&
    hasStringProperty(value, "kemCipherText") &&
    hasStringProperty(value, "wrappedKey")
  );
}

export function isPutPrincipalPolicyRequest(
  value: unknown,
): value is PutPrincipalPolicyRequest {
  return (
    isPlainObject(value) &&
    hasObjectProperty(value, "state") &&
    isPrincipalStateRequest(value.state) &&
    hasObjectProperty(value, "encryptedPayload") &&
    isPrincipalStateEncryptedPayloadRequest(value.encryptedPayload) &&
    hasArrayProperty(value, "projection") &&
    value.projection.every(isPrincipalProjectionMemberRequest) &&
    hasArrayProperty(value, "memberEnvelopes") &&
    value.memberEnvelopes.every(isPrincipalMemberEnvelopeRequest)
  );
}
