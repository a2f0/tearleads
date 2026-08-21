// After a local backup is restored, the SQLite database and its root container
// have been replaced, but browser-local caches written BEFORE the restore still
// point at the pre-restore root:
//   - symcrypt.local-session:*  the persisted crypto session, which pins the
//     active root container (see localCryptoSessionPersistence.ts);
//   - symcrypt.documents*, symcrypt.container-metadata*  the per-scope CRDT
//     peer seeds for the documents / container-metadata trees (see the
//     DOCUMENTS_APP_KIND / CONTAINER_METADATA_APP_KIND scopes fed to
//     getScopedPeerSeed in client-sdk's crdtPeerSeed.ts).
// A plain reload re-bootstraps against those stale caches and surfaces an empty
// root, so Explorer/Notes look empty even though the rows were restored. Clearing
// them lets the next reload re-derive the root container and read models from the
// restored database.
//
// The identity registry (symcrypt.app.local-identity-*) is deliberately left
// intact so the same per-identity database file is reopened. This mirrors the
// screenshot pipeline's clearStaleLocalState (packages/app-web/screenshots/
// appShell.ts) — keep the two prefix lists in sync.
const STALE_RESTORE_CACHE_PREFIXES = [
  "symcrypt.local-session",
  "symcrypt.documents",
  "symcrypt.container-metadata",
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
