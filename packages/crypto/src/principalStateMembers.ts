import type {
  PrincipalProjectionMember,
  PrincipalStateMember,
} from "./principalStateTypes";

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Members are ordered by user id alone.
 *
 * This used to be a two-level compare on (type, id), because a group member and
 * a user member could share an id and had to sort distinctly. Group members no
 * longer exist, so identity is the user id and the ordering collapses.
 */
export function comparePrincipalStateMembers(
  left: PrincipalStateMember,
  right: PrincipalStateMember,
): number {
  return compareCanonicalStrings(left.userId, right.userId);
}

export function comparePrincipalProjectionMembers(
  left: PrincipalProjectionMember,
  right: PrincipalProjectionMember,
): number {
  return compareCanonicalStrings(left.userId, right.userId);
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
      previousMember.userId === currentMember.userId
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
      previousMember.userId === currentMember.userId
    ) {
      return true;
    }
  }

  return false;
}
