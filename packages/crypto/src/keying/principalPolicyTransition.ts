import type {
  PrincipalContainerGrant,
  PrincipalProjectionMember,
  SignedPrincipalState,
} from "../principalState";
import { normalizePrincipalProjectionMembers } from "../principalState";
import { throwVerification } from "./shared";
import type { PrincipalPolicySignedState } from "./types";

function principalProjectionMemberKey(
  member: PrincipalProjectionMember,
): string {
  return member.userId;
}

function principalProjectionRoleRank(
  role: PrincipalProjectionMember["role"],
): number {
  return role === "admin" ? 2 : 1;
}

function hasPrincipalPolicyProjectionShrink(input: {
  currentProjection: readonly PrincipalProjectionMember[];
  previousProjection: readonly PrincipalProjectionMember[];
}): boolean {
  const currentProjectionByMember = new Map<string, PrincipalProjectionMember>(
    input.currentProjection.map((member) => [
      principalProjectionMemberKey(member),
      member,
    ]),
  );

  return input.previousProjection.some((previousMember) => {
    const currentMember = currentProjectionByMember.get(
      principalProjectionMemberKey(previousMember),
    );

    if (!currentMember) {
      return true;
    }

    return (
      principalProjectionRoleRank(currentMember.role) <
      principalProjectionRoleRank(previousMember.role)
    );
  });
}

/**
 * Container KEK wraps sealed to a group's key stay stored after the group
 * loses a grant, so a member added later at the same key epoch could still
 * open them (#2365 finding 20). A grant may change its access level in place,
 * but dropping a container needs a new key, exactly like a projection shrink.
 */
function hasPrincipalPolicyGrantRemoval(input: {
  currentGrants: readonly PrincipalContainerGrant[];
  previousGrants: readonly PrincipalContainerGrant[];
}): boolean {
  const retained = new Set(
    input.currentGrants.map((grant) => grant.containerId),
  );
  return input.previousGrants.some((grant) => !retained.has(grant.containerId));
}

function principalPolicyKeyMaterialChanged(input: {
  currentState: SignedPrincipalState;
  previousState: SignedPrincipalState;
}): boolean {
  return (
    input.currentState.encapsulationPublicKey !==
      input.previousState.encapsulationPublicKey ||
    input.currentState.keyFingerprint !== input.previousState.keyFingerprint
  );
}

export type PrincipalPolicyTransitionMismatchCode =
  | "epoch_advance_without_key_material"
  | "grant_removal_without_key_rotation"
  | "key_change_without_epoch"
  | "key_epoch_decrease"
  | "key_epoch_jump"
  | "previous_hash_mismatch"
  | "principal_mismatch"
  | "shrink_without_key_rotation"
  | "version_not_contiguous";

export interface PrincipalPolicyTransitionMismatch {
  readonly code: PrincipalPolicyTransitionMismatchCode;
  readonly message: string;
}

function principalPolicyTransitionMismatch(
  code: PrincipalPolicyTransitionMismatchCode,
  message: string,
): PrincipalPolicyTransitionMismatch {
  return { code, message };
}

export function getPrincipalPolicyTransitionMismatch(input: {
  readonly current: {
    readonly grants: readonly PrincipalContainerGrant[];
    readonly projection: readonly PrincipalProjectionMember[];
    readonly state: SignedPrincipalState;
  };
  readonly previous: {
    readonly grants: readonly PrincipalContainerGrant[];
    readonly projection: readonly PrincipalProjectionMember[];
    readonly state: PrincipalPolicySignedState;
  };
}): PrincipalPolicyTransitionMismatch | null {
  const { current, previous } = input;

  if (
    current.state.principalType !== previous.state.principalType ||
    current.state.principalId !== previous.state.principalId
  ) {
    return principalPolicyTransitionMismatch(
      "principal_mismatch",
      "Principal policy transition principal mismatch",
    );
  }

  if (current.state.version !== previous.state.version + 1) {
    return principalPolicyTransitionMismatch(
      "version_not_contiguous",
      "Principal policy transition version is not contiguous",
    );
  }

  if (current.state.prevStateHash !== previous.state.stateHash) {
    return principalPolicyTransitionMismatch(
      "previous_hash_mismatch",
      "Principal policy transition previous hash mismatch",
    );
  }

  if (current.state.keyEpoch < previous.state.keyEpoch) {
    return principalPolicyTransitionMismatch(
      "key_epoch_decrease",
      "Principal policy key epoch cannot decrease",
    );
  }

  if (current.state.keyEpoch > previous.state.keyEpoch + 1) {
    return principalPolicyTransitionMismatch(
      "key_epoch_jump",
      "Principal policy key epoch must advance by exactly one",
    );
  }

  const previousProjection = normalizePrincipalProjectionMembers(
    previous.projection,
  );
  const currentProjection = normalizePrincipalProjectionMembers(
    current.projection,
  );
  const keyMaterialChanged = principalPolicyKeyMaterialChanged({
    currentState: current.state,
    previousState: previous.state,
  });

  if (
    current.state.keyEpoch === previous.state.keyEpoch &&
    keyMaterialChanged
  ) {
    return principalPolicyTransitionMismatch(
      "key_change_without_epoch",
      "Principal policy key change requires a new key epoch",
    );
  }

  if (current.state.keyEpoch > previous.state.keyEpoch && !keyMaterialChanged) {
    return principalPolicyTransitionMismatch(
      "epoch_advance_without_key_material",
      "Principal policy key epoch advance requires new key material",
    );
  }

  if (
    hasPrincipalPolicyProjectionShrink({
      currentProjection,
      previousProjection,
    }) &&
    (current.state.keyEpoch <= previous.state.keyEpoch || !keyMaterialChanged)
  ) {
    return principalPolicyTransitionMismatch(
      "shrink_without_key_rotation",
      "Principal policy shrink requires a new key epoch and key material",
    );
  }

  if (
    hasPrincipalPolicyGrantRemoval({
      currentGrants: current.grants,
      previousGrants: previous.grants,
    }) &&
    current.state.keyEpoch <= previous.state.keyEpoch
  ) {
    return principalPolicyTransitionMismatch(
      "grant_removal_without_key_rotation",
      "Principal policy grant removal requires a new key epoch",
    );
  }

  return null;
}

export function getPrincipalPolicyTransitionMismatchReason(
  input: Parameters<typeof getPrincipalPolicyTransitionMismatch>[0],
): string | null {
  return getPrincipalPolicyTransitionMismatch(input)?.message ?? null;
}

/** key_epoch_reuse classifies all epoch/key-material continuity violations. */
export function throwPrincipalPolicyTransitionError(
  mismatch: PrincipalPolicyTransitionMismatch,
): never {
  switch (mismatch.code) {
    case "epoch_advance_without_key_material":
    case "grant_removal_without_key_rotation":
    case "key_change_without_epoch":
    case "key_epoch_decrease":
    case "key_epoch_jump":
    case "shrink_without_key_rotation":
      return throwVerification("key_epoch_reuse", mismatch.message);
    case "previous_hash_mismatch":
      return throwVerification("stale_predecessor", mismatch.message);
    case "principal_mismatch":
    case "version_not_contiguous":
      return throwVerification("invalid_shape", mismatch.message);
  }
}
