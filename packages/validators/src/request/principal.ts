import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasStringProperty,
  isUuidV4String,
} from "../util";

export interface PrincipalStateMemberRequest {
  principalType: "user" | "group";
  principalId: string;
}

export interface PutPrincipalStateRequest {
  principalType: "group" | "organization";
  principalId: string;
  version: number;
  prevStateHash: string | null;
  keyEpoch: number;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  members: PrincipalStateMemberRequest[];
  membershipRoot: string;
  signedAt: string;
  signerKeyId: string;
  signature: string;
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
): value is PutPrincipalStateRequest["principalType"] {
  return value === "group" || value === "organization";
}

function isPrincipalStateMemberType(
  value: string,
): value is PrincipalStateMemberRequest["principalType"] {
  return value === "user" || value === "group";
}

function isPrincipalStateMemberRequest(
  value: unknown,
): value is PrincipalStateMemberRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "principalType") &&
    isPrincipalStateMemberType(value.principalType) &&
    hasStringProperty(value, "principalId") &&
    isUuidV4String(value.principalId)
  );
}

function isPrincipalMemberEnvelopeRequest(
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
    hasStringProperty(value, "principalType") &&
    isManagedPrincipalType(value.principalType) &&
    hasStringProperty(value, "principalId") &&
    isUuidV4String(value.principalId) &&
    hasNumberProperty(value, "version") &&
    hasNullableStringProperty(value, "prevStateHash") &&
    hasNumberProperty(value, "keyEpoch") &&
    hasStringProperty(value, "encapsulationPublicKey") &&
    hasStringProperty(value, "keyFingerprint") &&
    hasArrayProperty(value, "members") &&
    value.members.every(isPrincipalStateMemberRequest) &&
    hasStringProperty(value, "membershipRoot") &&
    hasStringProperty(value, "signedAt") &&
    hasStringProperty(value, "signerKeyId") &&
    hasStringProperty(value, "signature")
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
