import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type {
  PrincipalContainerGrant,
  PrincipalProjectionMember,
  PrincipalStateExternalAuthority,
} from "../principalState";
import {
  isPrincipalProjectionRole,
  toUnsignedPrincipalState,
} from "../principalState";
import { normalizePrincipalPolicyStateChainEntry } from "./principalPolicyChainEntry";
import { assertExactKeys, throwVerification } from "./shared";
import type {
  NormalizedPrincipalPolicyStateChainEntry,
  PrincipalPolicySignedState,
} from "./types";

export function capturePrincipalHistoryAuthority(
  authority: PrincipalStateExternalAuthority,
) {
  return {
    principalType: authority.principalType,
    principalId: authority.principalId,
    version: authority.version,
    keyEpoch: authority.keyEpoch,
    stateHash: authority.stateHash,
    keyFingerprint: authority.keyFingerprint,
  };
}

/** Persist protocol fields only; caller metadata is not signed history. */
export function capturePrincipalHistoryProgressEntry(
  entry: NormalizedPrincipalPolicyStateChainEntry,
) {
  const { state } = entry;
  return {
    state: {
      ...toUnsignedPrincipalState(state),
      externalAuthority: state.externalAuthority
        ? capturePrincipalHistoryAuthority(state.externalAuthority)
        : null,
      signature: state.signature,
      stateHash: state.stateHash,
    },
    projection: entry.projection.map(({ userId, role }) => ({ userId, role })),
    grants: entry.grants.map(({ containerId, accessLevel }) => ({
      containerId,
      accessLevel,
    })),
  };
}

function isAuthority(value: unknown): value is PrincipalStateExternalAuthority {
  if (!isPlainObject(value)) return false;
  const {
    principalType,
    principalId,
    version,
    keyEpoch,
    stateHash,
    keyFingerprint,
  } = value;
  return (
    principalType === "group" &&
    typeof principalId === "string" &&
    typeof version === "number" &&
    typeof keyEpoch === "number" &&
    typeof stateHash === "string" &&
    typeof keyFingerprint === "string"
  );
}

function isSignedState(value: unknown): value is PrincipalPolicySignedState {
  if (!isPlainObject(value)) return false;
  const { principalType, membershipMode, prevStateHash, externalAuthority } =
    value;
  const strings = [
    "principalId",
    "encapsulationPublicKey",
    "keyFingerprint",
    "membershipRoot",
    "memberEnvelopesRoot",
    "projectionRoot",
    "grantRoot",
    "payloadCiphertextHash",
    "signedAt",
    "signerUserId",
    "signerUserKeyFingerprint",
    "signature",
    "stateHash",
  ];
  const numbers = ["version", "keyEpoch", "memberCount", "grantCount"];
  return (
    (principalType === "group" || principalType === "organization") &&
    membershipMode === "projection" &&
    (prevStateHash === null || typeof prevStateHash === "string") &&
    (externalAuthority === null || isAuthority(externalAuthority)) &&
    strings.every((key) => typeof value[key] === "string") &&
    numbers.every((key) => typeof value[key] === "number")
  );
}

function isMember(value: unknown): value is PrincipalProjectionMember {
  if (!isPlainObject(value)) return false;
  const { userId, role } = value;
  return (
    typeof userId === "string" &&
    typeof role === "string" &&
    isPrincipalProjectionRole(role)
  );
}

function isGrant(value: unknown): value is PrincipalContainerGrant {
  if (!isPlainObject(value)) return false;
  const { containerId, accessLevel } = value;
  return (
    typeof containerId === "string" &&
    (accessLevel === "admin" ||
      accessLevel === "read" ||
      accessLevel === "write")
  );
}

/** Decode only after local progress authentication, then recheck commitments. */
export function normalizeAuthenticatedPrincipalHistoryEntry(value: unknown) {
  const entry = assertExactKeys(
    value,
    ["state", "projection", "grants"],
    "saved history entry",
  );
  if (
    !isSignedState(entry.state) ||
    !Array.isArray(entry.projection) ||
    !entry.projection.every(isMember) ||
    !Array.isArray(entry.grants) ||
    !entry.grants.every(isGrant)
  )
    throwVerification(
      "invalid_shape",
      "saved principal history entry is malformed",
    );
  // The normalizer enforces numeric domains, signing-time format and all
  // commitments. This cannot replace prefix verification: the local envelope
  // is what authenticates the earlier authorization and signature checks.
  return normalizePrincipalPolicyStateChainEntry({
    state: entry.state,
    projection: entry.projection,
    grants: entry.grants,
  });
}
