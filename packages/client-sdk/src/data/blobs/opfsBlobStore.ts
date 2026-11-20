import { waitForRead } from "../shared/waitForRead";
import {
  type BlobByteSource,
  type BlobBytes,
  type BlobStore,
  blobByteSourceInputLength,
  createBlobByteSource,
  readBlobByteSource,
} from "./blobContracts";

import { commitOpfsFile } from "./opfsBlobFile";

interface StorageDirectoryProvider {
  getDirectory: () => Promise<FileSystemDirectoryHandle>;
}

const OPFS_WRITE_CHUNK_SIZE = 5 * 1024 * 1024;

class OpfsBlobStore implements BlobStore {
  private directoryPromise: Promise<FileSystemDirectoryHandle> | null = null;

  private readonly active = new Set<Promise<unknown>>();
  private readonly writers = new Map<string, Promise<unknown>>();
  private purgeBarrier: Promise<void> | undefined;

  constructor(private readonly namespace: string) {}

  // File operations run concurrently. A directory removal waits for all
  // of them and any later file operation opens the surviving directory.
  private async useFile<T>(
    key: string,
    mode: LockMode,
    run: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const locked = () => {
      signal?.throwIfAborted();
      const locks = navigator.locks;
      return typeof locks?.request === "function"
        ? locks.request(
            JSON.stringify(["tearleads.opfs.blob", this.namespace, key]),
            signal ? { mode, signal } : { mode },
            run,
          )
        : run();
    };
    const writer = this.writers.get(key);
    const operation =
      writer || this.purgeBarrier
        ? Promise.allSettled([writer, this.purgeBarrier]).then(locked)
        : locked();
    if (mode === "exclusive") this.writers.set(key, operation);
    this.active.add(operation);
    try {
      return await operation;
    } finally {
      this.active.delete(operation);
      if (this.writers.get(key) === operation) this.writers.delete(key);
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

  deleteBytes(storageKey: string, assertCurrent?: () => void) {
    return this.useFile(storageKey, "exclusive", () =>
      this.removeFile(storageKey, assertCurrent),
    );
  }

  private async removeFile(storageKey: string, assertCurrent?: () => void) {
    const directory = await this.getDirectory();

    try {
      assertCurrent?.();
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

  openByteSource(storageKey: string, signal?: AbortSignal) {
    return waitForRead(
      this.useFile(
        storageKey,
        "shared",
        () => waitForRead(this.openFile(storageKey, signal), signal),
        signal,
      ),
      signal,
    );
  }

  private async openFile(storageKey: string, signal?: AbortSignal) {
    try {
      // A cancelled preview may finish its native lookup after logout. It only
      // opens existing directories, so that late read cannot recreate a namespace.
      const directory = await (signal
        ? (this.directoryPromise ?? this.createDirectory(false, signal))
        : this.getDirectory());
      signal?.throwIfAborted();
      const fileHandle = await directory.getFileHandle(
        this.getFileName(storageKey),
      );
      signal?.throwIfAborted();
      const file = await fileHandle.getFile();
      signal?.throwIfAborted();
      return createBlobByteSource(file);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return null;
      }

      throw error;
    }
  }

  writeByteSource(
    storageKey: string,
    source: BlobByteSource,
    assertCurrent?: () => void,
  ) {
    return this.useFile(storageKey, "exclusive", () =>
      this.writeFile(storageKey, source, assertCurrent),
    );
  }

  private async writeFile(
    storageKey: string,
    source: BlobByteSource,
    assertCurrent?: () => void,
  ) {
    const sourceByteLength = blobByteSourceInputLength(source);
    const directory = await this.getDirectory();
    await commitOpfsFile(
      directory,
      this.getFileName(storageKey),
      assertCurrent,
      async (writable) => {
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
      },
    );
  }

  async writeBytes(
    storageKey: string,
    bytes: BlobBytes,
    assertCurrent?: () => void,
  ) {
    await this.writeByteSource(
      storageKey,
      createBlobByteSource(bytes),
      assertCurrent,
    );
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

  private async createDirectory(create = true, signal?: AbortSignal) {
    const rootDirectory = await navigator.storage.getDirectory();
    signal?.throwIfAborted();
    const appDirectory = await rootDirectory.getDirectoryHandle("tearleads", {
      create,
    });

    signal?.throwIfAborted();
    return appDirectory.getDirectoryHandle(this.namespace, { create });
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
