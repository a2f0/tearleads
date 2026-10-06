// Where a persistent database's SAHPool lives. Kept apart from the SQLite
// loader so code that only needs the location, such as the main-thread purge,
// does not import the loader and the SQLite module it loads.

/**
 * OPFS directory root and registered VFS name prefix for persistent SAHPools.
 * The final directory/name are derived from the SQLite database name so separate
 * pane databases can be opened by separate workers without contending on the
 * same SAHPool access-handle files. Keep the derivation stable: changing it
 * changes where persisted bytes live.
 */
export const SAHPOOL_VFS_NAME_PREFIX = "tearleads-opfs-sahpool";
export const SAHPOOL_DIRECTORY_ROOT = "/tearleads-sqlite";

function sahPoolStorageSegmentForDbName(dbName: string): string {
  const normalized = dbName
    .trim()
    .replace(/^\/+/u, "")
    // Preserve dots so `a.b` and `a_b` do not collapse to the same SAHPool.
    .replace(/[^a-zA-Z0-9_.-]+/gu, "_")
    .replace(/^_+/u, "");
  // Scan from the end to avoid regex backtracking over internal underscore runs.
  let end = normalized.length;
  while (end > 0 && normalized[end - 1] === "_") {
    end -= 1;
  }
  const segment = normalized.slice(0, end);
  // A literal "." or ".." could be interpreted as navigation relative to the
  // SAHPool root; keep those reserved names mapped to a regular child segment.
  return !segment || segment === "." || segment === ".." ? "default" : segment;
}

export function persistentSahPoolStorageForDbName(dbName: string): {
  directory: string;
  vfsName: string;
} {
  const segment = sahPoolStorageSegmentForDbName(dbName);
  return {
    directory: `${SAHPOOL_DIRECTORY_ROOT}/${segment}`,
    vfsName: `${SAHPOOL_VFS_NAME_PREFIX}-${segment}`,
  };
}
