// Matches a trailing GitHub reference like " (#1531)" at the very end of a
// subject line. Anchored to the end so a mid-subject reference is left intact,
// and un-globbed so only the final reference is removed per call.
const PR_NUMBER_SUFFIX = /\s*\(#\d+\)$/;

/** Strip the single trailing `(#<n>)` reference from a subject, if present. */
export function stripPrNumberSuffix(subject: string): string {
  return subject.replace(PR_NUMBER_SUFFIX, "");
}

/**
 * Append ` (#<prNumber>)` to a subject that has already had its trailing
 * reference removed (see `stripPrNumberSuffix`). Deliberately strip-free: the
 * caller strips exactly once, so the validated base and the merged subject stay
 * in sync and an earlier `(#<n>)` reference is never silently discarded. Throws
 * when `prNumber` is not a positive integer.
 */
export function appendPrNumberSuffix(
  baseSubject: string,
  prNumber: string,
): string {
  if (!/^\d+$/.test(prNumber)) {
    throw new Error(
      `Invalid PR number '${prNumber}' for the squash subject suffix.`,
    );
  }
  const result = `${baseSubject} (#${prNumber})`;
  assertPrNumberSuffix(result, prNumber);
  return result;
}

/**
 * Assert a subject ends with the exact `(#<prNumber>)` reference — the invariant
 * every squash subject must satisfy before the merge runs.
 */
export function assertPrNumberSuffix(subject: string, prNumber: string): void {
  const suffix = ` (#${prNumber})`;
  if (!subject.endsWith(suffix)) {
    throw new Error(
      `Squash subject must end with '${suffix}', got: '${subject}'.`,
    );
  }
}
