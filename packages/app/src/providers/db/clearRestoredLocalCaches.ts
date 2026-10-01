// After a local backup is restored, the SQLite database and its root container
// have been replaced, but browser-local caches written BEFORE the restore still
// point at the pre-restore root: tearleads.documents* and
// tearleads.container-metadata*, the per-scope CRDT peer seeds for the
// documents / container-metadata trees (see the DOCUMENTS_APP_KIND /
// CONTAINER_METADATA_APP_KIND scopes fed to getScopedPeerSeed in client-sdk's
// crdtPeerSeed.ts). A plain reload re-bootstraps against those stale caches and
// surfaces an empty root, so Explorer/Notes look empty even though the rows
// were restored. Clearing them lets the next reload re-derive the root
// container and read models from the restored database.
//
// The persisted crypto session (tearleads.local-session:*) is not cleared: it
// holds the identity's root acknowledgements, which a restore must not discard
// (#2365 finding 24). The crypto provider's prepareForRestoreReload rewrites the
// active identity's record signed out, with no pinned root, before this runs;
// other identities' databases were not replaced. The identity registry
// (tearleads.app.local-identity-*) is also kept, so the same per-identity
// database file is reopened.
const STALE_RESTORE_CACHE_PREFIXES = [
  "tearleads.documents",
  "tearleads.container-metadata",
] as const;

type ClearableStorage = Pick<Storage, "key" | "length" | "removeItem">;

export function clearRestoredLocalCaches(
  // Guard window so importing/calling this outside a browser (SSR, some test
  // runners) can't throw a ReferenceError; there is nothing to clear there.
  storage: ClearableStorage | undefined = typeof window === "undefined"
    ? undefined
    : window.localStorage,
): void {
  if (!storage) {
    return;
  }

  // Collect first, then remove: removing during the index walk would shift the
  // remaining keys and skip entries.
  const staleKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (
      key !== null &&
      STALE_RESTORE_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      staleKeys.push(key);
    }
  }

  for (const key of staleKeys) {
    storage.removeItem(key);
  }
}
