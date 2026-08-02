import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasObjectProperty,
  hasStringProperty,
  PRINCIPAL_POLICY_HISTORY_ENVELOPES_PER_STATE_LIMIT,
  PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT,
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
  memberEnvelopesRoot: string;
  projectionRoot: string;
  payloadCiphertextHash: string;
  memberCount: number;
  externalAuthority: PrincipalStateExternalAuthorityResponse | null;
  signedAt: string;
  signerUserId: string;
  signerUserKeyFingerprint: string;
  signature: string;
  stateHash: string;
  createdAt: string;
}

export interface PrincipalStateExternalAuthorityResponse {
  principalType: "group";
  principalId: string;
  version: number;
  keyEpoch: number;
  stateHash: string;
  keyFingerprint: string;
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
  keyFingerprint: string;
}

export interface PrincipalPolicyStateChainEntryResponse {
  state: PrincipalStateResponse;
  projection: PrincipalProjectionMemberResponse[];
}

/**
 * One historical state, with the envelopes this requester could open at it.
 *
 * Distinct from `PrincipalPolicyStateChainEntryResponse`, which carries the
 * signed header and projection but no key material: verifying the chain and
 * recovering a key off it are different jobs, and only the recovery path pays
 * for the envelopes.
 */
export interface PrincipalPolicyHistoryEntryResponse {
  state: PrincipalStateResponse;
  projection: PrincipalProjectionMemberResponse[];
  /**
   * Envelopes at this state addressed to the requester or to a principal that
   * authorizes them. Never the full member set — one member's envelope is not
   * another's to read.
   */
  memberEnvelopes: PrincipalMemberEnvelopeResponse[];
}

export interface PrincipalPolicyHistoryResponse {
  principalType: "group" | "organization";
  principalId: string;
  entries: PrincipalPolicyHistoryEntryResponse[];
  /** True when states below this page's oldest remain unserved. */
  hasMore: boolean;
}

export interface PrincipalPolicyBundleResponse {
  currentState: PrincipalStateResponse;
  currentPayload: PrincipalStatePayloadResponse;
  currentProjection: PrincipalProjectionMemberResponse[];
  currentMemberEnvelopes: CurrentPrincipalMemberEnvelopesResponse;
  previousStates: PrincipalPolicyStateChainEntryResponse[];
}

export interface PrincipalPolicyStaleErrorResponse {
  error: string;
  code: "principal_policy_stale";
  principalPolicies: PrincipalPolicyBundleResponse[];
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
  const externalAuthority = isPlainObject(value)
    ? Reflect.get(value, "externalAuthority")
    : undefined;
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
    hasStringProperty(value, "stateHash") &&
    hasStringProperty(value, "keyFingerprint")
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

export function isPrincipalPolicyHistoryEntryResponse(
  value: unknown,
): value is PrincipalPolicyHistoryEntryResponse {
  return (
    isPlainObject(value) &&
    hasObjectProperty(value, "state") &&
    isPrincipalStateResponse(value.state) &&
    hasArrayProperty(value, "projection") &&
    value.projection.every(isPrincipalProjectionMemberResponse) &&
    hasArrayProperty(value, "memberEnvelopes") &&
    // The same per-state bound the server applies, re-checked on the way in so
    // a hostile server cannot hand back an unbounded page.
    value.memberEnvelopes.length <=
      PRINCIPAL_POLICY_HISTORY_ENVELOPES_PER_STATE_LIMIT &&
    value.memberEnvelopes.every(isPrincipalMemberEnvelopeResponse)
  );
}

/**
 * Strictly descending by version.
 *
 * The recovery walk consumes pages newest-first and verifies each state
 * against the next one's `prevStateHash`. A repeated or out-of-order version
 * would re-apply a state already verified, or break the chain check on a page
 * boundary, so the ordering is part of the contract rather than a convention.
 */
function isStrictlyDescendingByVersion(
  entries: readonly PrincipalPolicyHistoryEntryResponse[],
): boolean {
  for (const [index, entry] of entries.entries()) {
    const previous = entries[index - 1];
    if (previous && entry.state.version >= previous.state.version) {
      return false;
    }
  }
  return true;
}

export function isPrincipalPolicyHistoryResponse(
  value: unknown,
): value is PrincipalPolicyHistoryResponse {
  if (
    !isPlainObject(value) ||
    !hasStringProperty(value, "principalType") ||
    !isManagedPrincipalType(value.principalType) ||
    !hasStringProperty(value, "principalId") ||
    typeof Reflect.get(value, "hasMore") !== "boolean" ||
    !hasArrayProperty(value, "entries")
  ) {
    return false;
  }

  const entries: unknown[] = value.entries;
  if (entries.length > PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT) {
    return false;
  }

  const validated: PrincipalPolicyHistoryEntryResponse[] = [];
  for (const entry of entries) {
    if (!isPrincipalPolicyHistoryEntryResponse(entry)) {
      return false;
    }
    validated.push(entry);
  }
  return isStrictlyDescendingByVersion(validated);
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

export function isPrincipalPolicyStaleErrorResponse(
  value: unknown,
): value is PrincipalPolicyStaleErrorResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "error") &&
    hasStringProperty(value, "code") &&
    value.code === "principal_policy_stale" &&
    hasArrayProperty(value, "principalPolicies") &&
    value.principalPolicies.every(isPrincipalPolicyBundleResponse)
  );
}
