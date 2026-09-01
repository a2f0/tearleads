import { persistentSahPoolStorageForDbName } from "./loadSqlite3";

interface StorageDirectoryProvider {
  getDirectory: () => Promise<FileSystemDirectoryHandle>;
}

function hasStorageDirectory(
  storage: StorageManager | undefined,
): storage is StorageManager & StorageDirectoryProvider {
  return (
    storage !== undefined &&
    "getDirectory" in storage &&
    typeof storage.getDirectory === "function"
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

/**
 * Main-thread fallback that deletes the OPFS directory backing a persistent
 * database's SAHPool VFS, by database name. Use when no worker is alive to run
 * the in-worker `delete` op (worker cleared/killed/failed to boot) but the
 * persisted SQLite files must still be wiped — e.g. logging out and discarding
 * local data. No-op when OPFS is unavailable or the directory was never
 * created; never throws on a missing directory.
 *
 * This removes the whole SAHPool directory (all of its access-handle files), so
 * it must not run while a worker still holds those handles — call it only after
 * the runtime has been torn down.
 */
export async function purgeOpfsSqliteDatabase(dbName: string): Promise<void> {
  if (
    typeof navigator !== "object" ||
    !hasStorageDirectory(navigator.storage)
  ) {
    return;
  }

  // `directory` is an OPFS-absolute path like `/tearleads-sqlite/<segment>`;
  // navigate it segment-by-segment from the OPFS root.
  const { directory } = persistentSahPoolStorageForDbName(dbName);
  const segments = directory.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return;
  }

  const leaf = segments[segments.length - 1];
  if (leaf === undefined) {
    return;
  }
  const parents = segments.slice(0, -1);

  let dir = await navigator.storage.getDirectory();
  try {
    for (const parent of parents) {
      dir = await dir.getDirectoryHandle(parent);
    }
    await dir.removeEntry(leaf, { recursive: true });
  } catch (error) {
    if (isNotFound(error)) {
      return;
    }
    throw error;
  }
}
