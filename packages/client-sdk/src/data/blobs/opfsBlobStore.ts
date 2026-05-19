import type { BlobBytes, BlobStore } from "../blobContracts";

interface StorageDirectoryProvider {
  getDirectory: () => Promise<FileSystemDirectoryHandle>;
}

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
    const directory = await this.getDirectory();

    try {
      const fileHandle = await directory.getFileHandle(
        this.getFileName(storageKey),
      );
      const file = await fileHandle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return null;
      }

      throw error;
    }
  }

  async writeBytes(storageKey: string, bytes: BlobBytes) {
    const directory = await this.getDirectory();
    const fileHandle = await directory.getFileHandle(
      this.getFileName(storageKey),
      { create: true },
    );
    const writable = await fileHandle.createWritable();

    try {
      await writable.write(bytes);
    } finally {
      await writable.close();
    }
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
