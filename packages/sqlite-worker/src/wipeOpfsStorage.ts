// Removes everything this origin keeps in the origin private file system. Kept
// apart from the SQLite loader so the main thread can run it without loading
// SQLite.

interface StorageDirectoryProvider {
  getDirectory: () => Promise<FileSystemDirectoryHandle>;
}

export interface WipeOpfsStorageOptions {
  /** Removal attempts per root entry before the wipe fails. */
  readonly attempts?: number;
  /** Pause between attempts on one entry. */
  readonly retryDelayMs?: number;
}

/** Whether OPFS existed here to be wiped. */
export type WipeOpfsStorageResult = "wiped" | "unavailable";

// A worker terminated during the previous page's unload releases its SAHPool
// access handles asynchronously, and removing a file whose handle is still open
// fails. Two seconds covers that release without hiding a handle someone
// still holds, such as another tab's database worker.
const DEFAULT_ATTEMPTS = 10;
const DEFAULT_RETRY_DELAY_MS = 200;

function hasStorageDirectory(
  storage: StorageManager | undefined,
): storage is StorageManager & StorageDirectoryProvider {
  return (
    storage !== undefined &&
    "getDirectory" in storage &&
    typeof storage.getDirectory === "function"
  );
}

async function removeRootEntry(
  root: FileSystemDirectoryHandle,
  name: string,
  attempts: number,
  retryDelayMs: number,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await root.removeEntry(name, { recursive: true });
      return;
    } catch (error) {
      if (error instanceof Error && error.name === "NotFoundError") {
        return;
      }
      if (attempt >= attempts) {
        throw new Error(`Could not remove "${name}" from OPFS.`, {
          cause: error,
        });
      }
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, retryDelayMs);
    await promise;
  }
}

/**
 * Device reset: remove every entry in this origin's OPFS root, which holds
 * every SQLite database's SAHPool directory, the blob store, and any other
 * file the app keeps there. Nothing may hold an access handle on those files;
 * a handle a just-terminated worker has not released yet is retried briefly.
 *
 * WKWebView exposes OPFS only inside workers, so there the database worker
 * runs this (its `wipeStorage` request) instead of the main thread. Resolves
 * `"unavailable"` without doing anything when this context has no OPFS.
 */
export async function wipeOpfsStorage(
  options: WipeOpfsStorageOptions = {},
): Promise<WipeOpfsStorageResult> {
  if (
    typeof navigator !== "object" ||
    !hasStorageDirectory(navigator.storage)
  ) {
    return "unavailable";
  }

  const root = await navigator.storage.getDirectory();
  // Collect first: removing entries while iterating the directory can skip
  // some of them.
  const names: string[] = [];
  for await (const [name] of root.entries()) {
    names.push(name);
  }

  for (const name of names) {
    await removeRootEntry(
      root,
      name,
      options.attempts ?? DEFAULT_ATTEMPTS,
      options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    );
  }
  return "wiped";
}
