// Where the desktop keeps its state. The desktop reads and writes one JSON
// document through an adapter, so each host chooses the medium: an encrypted
// store, the origin private file system, or memory.

/** Reads and writes the desktop's serialized state. */
export interface DesktopStateStorage {
  /** The stored text, or null when nothing is stored yet. */
  read: () => Promise<string | null>;
  /** Replaces the stored text. */
  write: (serialized: string) => Promise<void>;
}

/** Keeps the state in memory, for the life of the adapter. */
export function createMemoryDesktopStateStorage(
  initial: string | null = null,
): DesktopStateStorage {
  let stored = initial;
  return {
    read: async () => stored,
    write: async (serialized) => {
      stored = serialized;
    },
  };
}

export interface OpfsDesktopStateStorageOptions {
  /** Directories below the origin's root that hold the file, outermost first. */
  directory?: ReadonlyArray<string> | undefined;
  /** The file's name. Defaults to `desktop-state.json`. */
  fileName?: string | undefined;
}

interface StorageWithDirectory {
  getDirectory: () => Promise<FileSystemDirectoryHandle>;
}

function opfsRoot(): Promise<FileSystemDirectoryHandle> {
  const storage: Partial<StorageWithDirectory> | undefined =
    typeof navigator === "object" ? navigator.storage : undefined;
  if (typeof storage?.getDirectory !== "function") {
    return Promise.reject(
      new Error("The origin private file system is not available."),
    );
  }
  return storage.getDirectory();
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

/**
 * Keeps the state as a file in the origin private file system (OPFS). Reading
 * a file or directory that does not exist yet yields null; any other failure,
 * including a browser without OPFS, rejects.
 */
export function createOpfsDesktopStateStorage({
  directory = [],
  fileName = "desktop-state.json",
}: OpfsDesktopStateStorageOptions = {}): DesktopStateStorage {
  async function openDirectory(create: boolean) {
    let handle = await opfsRoot();
    for (const name of directory) {
      handle = await handle.getDirectoryHandle(name, { create });
    }
    return handle;
  }

  return {
    read: async () => {
      try {
        const parent = await openDirectory(false);
        const file = await (await parent.getFileHandle(fileName)).getFile();
        return await file.text();
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },
    write: async (serialized) => {
      const parent = await openDirectory(true);
      const handle = await parent.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(serialized);
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
      await writable.close();
    },
  };
}
