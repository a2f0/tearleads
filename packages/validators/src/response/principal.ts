import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasObjectProperty,
  hasStringProperty,
} from "../util";

export interface PrincipalStateMemberResponse {
  principalType: "user" | "group";
  principalId: string;
}

export interface PrincipalStateResponse {
  principalType: "group" | "organization";
  principalId: string;
  version: number;
  prevStateHash: string | null;
  keyEpoch: number;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  members: PrincipalStateMemberResponse[];
  membershipRoot: string;
  signedAt: string;
  signerKeyId: string;
  signature: string;
  stateHash: string;
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

export interface PrincipalPolicyBundleResponse {
  currentState: PrincipalStateResponse;
  currentMemberEnvelopes: CurrentPrincipalMemberEnvelopesResponse;
}

function isManagedPrincipalType(
  value: string,
): value is PrincipalStateResponse["principalType"] {
  return value === "group" || value === "organization";
}

function isPrincipalStateMemberType(
  value: string,
): value is PrincipalStateMemberResponse["principalType"] {
  return value === "user" || value === "group";
}

function isPrincipalStateMemberResponse(
  value: unknown,
): value is PrincipalStateMemberResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "principalType") &&
    isPrincipalStateMemberType(value.principalType) &&
    hasStringProperty(value, "principalId")
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
    hasArrayProperty(value, "members") &&
    value.members.every(isPrincipalStateMemberResponse) &&
    hasStringProperty(value, "membershipRoot") &&
    hasStringProperty(value, "signedAt") &&
    hasStringProperty(value, "signerKeyId") &&
    hasStringProperty(value, "signature") &&
    hasStringProperty(value, "stateHash") &&
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

export function isPrincipalPolicyBundleResponse(
  value: unknown,
): value is PrincipalPolicyBundleResponse {
  return (
    isPlainObject(value) &&
    hasObjectProperty(value, "currentState") &&
    isPrincipalStateResponse(value.currentState) &&
    hasObjectProperty(value, "currentMemberEnvelopes") &&
    isCurrentPrincipalMemberEnvelopesResponse(value.currentMemberEnvelopes)
  );
}
