/**
 * Derives the SQLite database file name for the pre-identity bootstrap database.
 *
 * The namespace is sanitized into a filesystem-safe path segment so it can be
 * used directly as an OPFS file name once the database is persisted.
 */
export function sqliteDbNameForNamespace(namespace: string): string {
  const pathSegment =
    namespace.trim().replace(/[^a-zA-Z0-9._-]+/g, "_") || "default";
  return `/app-identity-bootstrap-${pathSegment}.db`;
}

/** Derives the per-identity SQLite database file name. */
export function sqliteDbNameForSigningFingerprint(
  signingFingerprint: string,
): string {
  return `/app-identity-${signingFingerprint}.db`;
}
