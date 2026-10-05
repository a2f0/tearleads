import {
  computePrincipalStateHash,
  normalizePrincipalProjectionMembers,
  type PrincipalProjectionMember,
} from "../principalState";
import {
  verifyPrincipalPolicyGrantCommitments,
  verifyPrincipalPolicyProjectionCommitments,
} from "./principalPolicyCommitments";
import {
  externalAuthorityIncludesAdminSigner,
  type PrincipalPolicyExternalAuthorityVerifier,
} from "./principalPolicyExternalAuthority";
import {
  getPrincipalPolicyTransitionMismatch,
  throwPrincipalPolicyTransitionError,
} from "./principalPolicyTransition";
import { throwVerification } from "./shared";
import type {
  NormalizedPrincipalPolicyStateChainEntry,
  PrincipalPolicySignedState,
  PrincipalPolicyStateChainEntry,
} from "./types";

function projectionIncludesAdminUser(
  projection: readonly PrincipalProjectionMember[],
  userId: string,
): boolean {
  return projection.some(
    (member) => member.userId === userId && member.role === "admin",
  );
}

export async function normalizePrincipalPolicyStateChainEntry(
  entry: PrincipalPolicyStateChainEntry,
): Promise<NormalizedPrincipalPolicyStateChainEntry> {
  const projection = normalizePrincipalProjectionMembers(entry.projection);
  const computedStateHash = await computePrincipalStateHash(entry.state);

  if (computedStateHash !== entry.state.stateHash) {
    throwVerification(
      "hash_mismatch",
      "principal policy state hash does not match signed state",
    );
  }

  await verifyPrincipalPolicyProjectionCommitments({
    projection,
    state: entry.state,
  });
  const grants = await verifyPrincipalPolicyGrantCommitments({
    grants: entry.grants,
    state: entry.state,
  });

  return {
    state: entry.state,
    projection,
    grants,
  };
}

export function verifyPrincipalPolicyChainEntryIdentity(input: {
  readonly currentState: PrincipalPolicySignedState;
  readonly expectedVersion: number;
  readonly normalizedEntry: NormalizedPrincipalPolicyStateChainEntry;
}): void {
  if (
    input.normalizedEntry.state.principalType !==
      input.currentState.principalType ||
    input.normalizedEntry.state.principalId !== input.currentState.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy chain entry principal does not match current state",
    );
  }

  if (input.normalizedEntry.state.version !== input.expectedVersion) {
    throwVerification(
      "stale_predecessor",
      "principal policy chain entry version is not contiguous",
    );
  }
}

export function verifyInitialPrincipalPolicyChainEntry(input: {
  readonly authorityVerifier: PrincipalPolicyExternalAuthorityVerifier;
  readonly normalizedEntry: NormalizedPrincipalPolicyStateChainEntry;
}): void {
  const { normalizedEntry } = input;

  if (normalizedEntry.state.prevStateHash !== null) {
    throwVerification(
      "stale_predecessor",
      "initial principal policy chain entry has a previous state hash",
    );
  }

  if (
    projectionIncludesAdminUser(
      normalizedEntry.projection,
      normalizedEntry.state.signerUserId,
    )
  ) {
    if (normalizedEntry.state.externalAuthority) {
      throwVerification(
        "invalid_shape",
        "directly authorized principal policy state cannot cite external authority",
      );
    }
    return;
  }

  if (
    normalizedEntry.projection.length === 0 &&
    externalAuthorityIncludesAdminSigner({
      entry: normalizedEntry,
      verifier: input.authorityVerifier,
    })
  ) {
    return;
  }

  throwVerification(
    "unauthorized",
    "initial principal policy state signer is not an admin",
  );
}

export function verifySuccessorPrincipalPolicyChainEntry(input: {
  readonly authorityVerifier: PrincipalPolicyExternalAuthorityVerifier;
  readonly normalizedEntry: NormalizedPrincipalPolicyStateChainEntry;
  readonly previousEntry: NormalizedPrincipalPolicyStateChainEntry;
}): void {
  if (
    input.normalizedEntry.state.prevStateHash !==
    input.previousEntry.state.stateHash
  ) {
    throwVerification(
      "stale_predecessor",
      "principal policy chain entry previous hash mismatch",
    );
  }

  const isDirectAdmin = projectionIncludesAdminUser(
    input.previousEntry.projection,
    input.normalizedEntry.state.signerUserId,
  );
  const isExternalAdmin = externalAuthorityIncludesAdminSigner({
    entry: input.normalizedEntry,
    verifier: input.authorityVerifier,
  });
  if (!isDirectAdmin && !isExternalAdmin) {
    throwVerification(
      "unauthorized",
      "principal policy state signer is not an admin in previous projection",
    );
  }
  if (isDirectAdmin && input.normalizedEntry.state.externalAuthority) {
    throwVerification(
      "invalid_shape",
      "directly authorized principal policy state cannot cite external authority",
    );
  }

  const transitionMismatch = getPrincipalPolicyTransitionMismatch({
    current: input.normalizedEntry,
    previous: input.previousEntry,
  });

  if (transitionMismatch) {
    throwPrincipalPolicyTransitionError(transitionMismatch);
  }
}
