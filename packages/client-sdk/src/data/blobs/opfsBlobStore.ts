import {
  type BlobByteSource,
  type BlobBytes,
  type BlobStore,
  blobByteSourceInputLength,
  createBlobByteSource,
  readBlobByteSource,
} from "./blobContracts";

interface StorageDirectoryProvider {
  getDirectory: () => Promise<FileSystemDirectoryHandle>;
}

const OPFS_WRITE_CHUNK_SIZE = 5 * 1024 * 1024;

class OpfsBlobStore implements BlobStore {
  private directoryPromise: Promise<FileSystemDirectoryHandle> | null = null;

  private readonly active = new Set<Promise<unknown>>();
  private purgeBarrier: Promise<void> | undefined;

  constructor(private readonly namespace: string) {}

  // File operations run concurrently. A directory removal waits for all
  // of them and any later file operation opens the surviving directory.
  private async useFile<T>(run: () => Promise<T>): Promise<T> {
    const operation = this.purgeBarrier ? this.purgeBarrier.then(run) : run();
    this.active.add(operation);
    try {
      return await operation;
    } finally {
      this.active.delete(operation);
    }
  }

  async purge(current: () => boolean): Promise<void> {
    const pending = Promise.allSettled([
      ...this.active,
      this.purgeBarrier,
    ]).then(async () => {
      if (current() && (await removeNamespace(this.namespace, current)))
        this.directoryPromise = null;
    });
    const barrier = pending.catch(() => {});
    this.purgeBarrier = barrier;
    try {
      await pending;
    } finally {
      if (this.purgeBarrier === barrier) this.purgeBarrier = undefined;
    }
  }

  deleteBytes(storageKey: string) {
    return this.useFile(() => this.removeFile(storageKey));
  }

  private async removeFile(storageKey: string) {
    const directory = await this.getDirectory();

    try {
      await directory.removeEntry(this.getFileName(storageKey));
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return;
      }

      throw error;
    }
  }

  async readBytes(storageKey: string) {
    const source = await this.openByteSource(storageKey);
    return source ? readBlobByteSource(source) : null;
  }

  openByteSource(storageKey: string) {
    return this.useFile(() => this.openFile(storageKey));
  }

  private async openFile(storageKey: string) {
    const directory = await this.getDirectory();

    try {
      const fileHandle = await directory.getFileHandle(
        this.getFileName(storageKey),
      );
      const file = await fileHandle.getFile();
      return createBlobByteSource(file);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return null;
      }

      throw error;
    }
  }

  writeByteSource(storageKey: string, source: BlobByteSource) {
    return this.useFile(() => this.writeFile(storageKey, source));
  }

  private async writeFile(storageKey: string, source: BlobByteSource) {
    const sourceByteLength = blobByteSourceInputLength(source);
    const directory = await this.getDirectory();
    const fileHandle = await directory.getFileHandle(
      this.getFileName(storageKey),
      { create: true },
    );
    const writable = await fileHandle.createWritable();

    try {
      for (let offset = 0; offset < sourceByteLength; ) {
        const byteLength = Math.min(
          OPFS_WRITE_CHUNK_SIZE,
          sourceByteLength - offset,
        );
        const chunk = await source.read(offset, byteLength);
        if (chunk.byteLength !== byteLength) {
          throw new Error("Blob byte source returned an incomplete read.");
        }
        await writable.write(chunk);
        offset += byteLength;
      }
      await writable.close();
    } catch (error) {
      await writable.abort(error).catch(() => undefined);
      throw error;
    }
  }

  async writeBytes(storageKey: string, bytes: BlobBytes) {
    await this.writeByteSource(storageKey, createBlobByteSource(bytes));
  }

  private getFileName(storageKey: string): string {
    return `${encodeURIComponent(storageKey)}.blob`;
  }

  private async getDirectory() {
    if (!this.directoryPromise) {
      this.directoryPromise = this.createDirectory().catch((error: unknown) => {
        this.directoryPromise = null;
        throw error;
      });
    }

    return this.directoryPromise;
  }

  private async createDirectory() {
    const rootDirectory = await navigator.storage.getDirectory();
    const appDirectory = await rootDirectory.getDirectoryHandle("tearleads", {
      create: true,
    });

    return appDirectory.getDirectoryHandle(this.namespace, { create: true });
  }
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

export function isOpfsBlobStoreSupported(): boolean {
  return (
    typeof navigator === "object" && hasStorageDirectory(navigator.storage)
  );
}

// Plain and encrypted stores address the same OPFS namespace.
const namespaces = new WeakMap<StorageManager, Map<string, OpfsBlobStore>>();

function namespaceStore(namespace: string): OpfsBlobStore {
  const storage = navigator.storage;
  let stores = namespaces.get(storage);
  if (!stores) {
    stores = new Map();
    namespaces.set(storage, stores);
  }
  let store = stores.get(namespace);
  if (!store) {
    store = new OpfsBlobStore(namespace);
    stores.set(namespace, store);
  }
  return store;
}

export function createOpfsBlobStore(namespace: string): BlobStore {
  return namespaceStore(namespace);
}

/**
 * Permanently remove the OPFS directory backing a namespace's blob store
 * (`tearleads/<namespace>`), discarding every stored blob for that namespace.
 * Used to forget local data on logout. No-op when OPFS is unavailable or the
 * directory was never created; never throws on a missing directory.
 */
export async function purgeOpfsBlobStore(
  namespace: string,
  current: () => boolean = () => true,
): Promise<void> {
  if (isOpfsBlobStoreSupported())
    await namespaceStore(namespace).purge(current);
}

async function removeNamespace(
  namespace: string,
  current: () => boolean,
): Promise<boolean> {
  const rootDirectory = await navigator.storage.getDirectory();
  let appDirectory: FileSystemDirectoryHandle;
  try {
    appDirectory = await rootDirectory.getDirectoryHandle("tearleads");
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return true;
    }
    throw error;
  }

  try {
    if (!current()) return false;
    await appDirectory.removeEntry(namespace, { recursive: true });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return true;
    }
    throw error;
  }
}
