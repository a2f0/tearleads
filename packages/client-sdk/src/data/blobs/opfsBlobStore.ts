import {
  type BlobByteSource,
  type BlobBytes,
  type BlobStore,
  blobByteSourceInputLength,
  createBlobByteSource,
  readBlobByteSource,
} from "../blobContracts";

interface StorageDirectoryProvider {
  getDirectory: () => Promise<FileSystemDirectoryHandle>;
}

const OPFS_WRITE_CHUNK_SIZE = 5 * 1024 * 1024;

class OpfsBlobStore implements BlobStore {
  private directoryPromise: Promise<FileSystemDirectoryHandle> | null = null;

  constructor(private readonly namespace: string) {}

  async deleteBytes(storageKey: string) {
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

  async openByteSource(storageKey: string) {
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

  async writeByteSource(storageKey: string, source: BlobByteSource) {
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
      this.directoryPromise = this.createDirectory();
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

export function createOpfsBlobStore(namespace: string): BlobStore {
  return new OpfsBlobStore(namespace);
}

/**
 * Permanently remove the OPFS directory backing a namespace's blob store
 * (`tearleads/<namespace>`), discarding every stored blob for that namespace.
 * Used to forget local data on logout. No-op when OPFS is unavailable or the
 * directory was never created; never throws on a missing directory.
 */
export async function purgeOpfsBlobStore(namespace: string): Promise<void> {
  if (!isOpfsBlobStoreSupported()) {
    return;
  }

  const rootDirectory = await navigator.storage.getDirectory();
  let appDirectory: FileSystemDirectoryHandle;
  try {
    appDirectory = await rootDirectory.getDirectoryHandle("tearleads");
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return;
    }
    throw error;
  }

  try {
    await appDirectory.removeEntry(namespace, { recursive: true });
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return;
    }
    throw error;
  }
}
