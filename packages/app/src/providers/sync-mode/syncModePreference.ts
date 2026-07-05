/**
 * Persisted user preference for whether this device syncs with the server.
 *
 * "sync" replicates documents with the server (the paid, per-organization
 * feature); "local-only" keeps everything on-device. The preference is the
 * *intent* — actual replication still requires being signed in and online, and
 * the server enforces org billing. Defaults to "sync" so a signed-in user keeps
 * replicating unless they explicitly choose to work locally.
 */
export type SyncMode = "local-only" | "sync";

export const DEFAULT_SYNC_MODE: SyncMode = "sync";

export const SYNC_MODE_STORAGE_KEY = "tearleads.sync-mode";

function getStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

function isSyncMode(value: string | null): value is SyncMode {
  return value === "local-only" || value === "sync";
}

export function loadSyncMode(): SyncMode {
  const storage = getStorage();
  if (!storage) {
    return DEFAULT_SYNC_MODE;
  }

  try {
    const stored = storage.getItem(SYNC_MODE_STORAGE_KEY);
    return isSyncMode(stored) ? stored : DEFAULT_SYNC_MODE;
  } catch {
    return DEFAULT_SYNC_MODE;
  }
}

export function saveSyncMode(mode: SyncMode): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(SYNC_MODE_STORAGE_KEY, mode);
  } catch {
    // Persistence is best-effort; ignore disabled storage / quota errors.
  }
}
