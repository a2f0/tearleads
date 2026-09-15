/**
 * Code-unit string order. Every hash, root, and signed encoding in this package
 * sorts with this comparator so that two runtimes with different locales
 * produce byte-identical canonical forms. `localeCompare` and `Intl.Collator`
 * are banned from hash-adjacent code by `scripts/checks/lintCanonicalOrdering.ts`.
 */
export function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
