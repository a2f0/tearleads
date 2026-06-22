/**
 * Paths excluded from review by default: lockfiles and build output, where a
 * diff is noise and wastes review tokens. Overridable via
 * CODE_ASSIST_IGNORE_PATTERNS (comma-separated globs).
 */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  "**/*.lock",
  "**/dist/**",
  "**/build/**",
  "**/.turbo/**",
  "**/*.tsbuildinfo",
];

export function isIgnoredPath(
  path: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((pattern) => new Bun.Glob(pattern).match(path));
}
