import type {
  PrincipalProjectionMember,
  PrincipalStateMember,
} from "./principalStateTypes";

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function comparePrincipalStateMembers(
  left: PrincipalStateMember,
  right: PrincipalStateMember,
): number {
  if (left.principalType === right.principalType) {
    return compareCanonicalStrings(left.principalId, right.principalId);
  }

  return compareCanonicalStrings(left.principalType, right.principalType);
}

export function comparePrincipalProjectionMembers(
  left: PrincipalProjectionMember,
  right: PrincipalProjectionMember,
): number {
  if (left.memberPrincipalType === right.memberPrincipalType) {
    return compareCanonicalStrings(
      left.memberPrincipalId,
      right.memberPrincipalId,
    );
  }

  return compareCanonicalStrings(
    left.memberPrincipalType,
    right.memberPrincipalType,
  );
}

export function hasDuplicateNormalizedPrincipalStateMembers(
  normalizedMembers: ReadonlyArray<PrincipalStateMember>,
): boolean {
  for (let index = 1; index < normalizedMembers.length; index += 1) {
    const previousMember = normalizedMembers[index - 1];
    const currentMember = normalizedMembers[index];

    if (
      previousMember &&
      currentMember &&
      previousMember.principalType === currentMember.principalType &&
      previousMember.principalId === currentMember.principalId
    ) {
      return true;
    }
  }

  return false;
}

export function hasDuplicateNormalizedPrincipalProjectionMembers(
  normalizedMembers: ReadonlyArray<PrincipalProjectionMember>,
): boolean {
  for (let index = 1; index < normalizedMembers.length; index += 1) {
    const previousMember = normalizedMembers[index - 1];
    const currentMember = normalizedMembers[index];

    if (
      previousMember &&
      currentMember &&
      previousMember.memberPrincipalType ===
        currentMember.memberPrincipalType &&
      previousMember.memberPrincipalId === currentMember.memberPrincipalId
    ) {
      return true;
    }
  }

  return false;
}
