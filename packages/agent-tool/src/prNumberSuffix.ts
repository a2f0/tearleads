// Matches a trailing GitHub reference like " (#1531)" at the very end of a
// subject line. Anchored to the end so a mid-subject reference is left intact.
const PR_NUMBER_SUFFIX = /\s*\(#\d+\)$/;

/** Strip a trailing `(#<n>)` reference from a subject, if one is present. */
export function stripPrNumberSuffix(subject: string): string {
  return subject.replace(PR_NUMBER_SUFFIX, "");
}

/**
 * Append the `(#<prNumber>)` reference to a squash subject so the commit ends
 * with the same GitHub-style PR reference the platform adds for web/default
 * squash merges. `gh pr merge --subject` suppresses that automatic suffix, so we
 * add it explicitly. Any existing trailing `(#<n>)` is replaced with the
 * authoritative PR number, keeping this idempotent across re-runs. Throws when
 * `prNumber` is not a positive integer.
 */
export function appendPrNumberSuffix(
  subject: string,
  prNumber: string,
): string {
  if (!/^\d+$/.test(prNumber)) {
    throw new Error(
      `Invalid PR number '${prNumber}' for the squash subject suffix.`,
    );
  }
  const result = `${stripPrNumberSuffix(subject)} (#${prNumber})`;
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
