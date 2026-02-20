/**
 * OPFS (Origin Private File System) storage adapter.
 * Used on web/electron platforms.
 */

import { decrypt, encrypt, importKey } from '@tearleads/shared';
import { measureRetrieveHelper, measureStoreHelper } from './metrics';
import type { FileStorage, RetrieveMetrics, StoreMetrics } from './types';
import { getFilesDirectory } from './types';

interface FileSystemDirectoryEntriesHandle extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  >;
}

function hasDirectoryEntries(
  directory: FileSystemDirectoryHandle
): directory is FileSystemDirectoryEntriesHandle {
  return 'entries' in directory;
}

function getDirectoryEntries(
  directory: FileSystemDirectoryHandle
): AsyncIterableIterator<
  [string, FileSystemDirectoryHandle | FileSystemFileHandle]
> {
  if (!hasDirectoryEntries(directory)) {
    throw new Error('OPFS entries() is not supported in this environment');
  }
  return directory.entries();
}

function isFileHandle(
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
): handle is FileSystemFileHandle {
  return handle.kind === 'file';
}

export class OPFSStorage implements FileStorage {
  public instanceId: string;
  private rootDirectory: FileSystemDirectoryHandle | null = null;
  private filesDirectory: FileSystemDirectoryHandle | null = null;
  private encryptionKey: CryptoKey | null = null;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
  }

  async initialize(encryptionKey: Uint8Array): Promise<void> {
    if (!('storage' in navigator) || !navigator.storage.getDirectory) {
      throw new Error('OPFS is not supported in this browser');
    }

    this.rootDirectory = await navigator.storage.getDirectory();
    const directoryName = getFilesDirectory(this.instanceId);
    this.filesDirectory = await this.rootDirectory.getDirectoryHandle(
      directoryName,
      { create: true }
    );
    this.encryptionKey = await importKey(encryptionKey);
  }

  async store(id: string, data: Uint8Array): Promise<string> {
    if (!this.filesDirectory || !this.encryptionKey) {
      throw new Error('Storage not initialized');
    }

    const encrypted = await encrypt(data, this.encryptionKey);
    const filename = `${id}.enc`;

    const fileHandle = await this.filesDirectory.getFileHandle(filename, {
      create: true
    });
    const writable = await fileHandle.createWritable();
    // Copy to plain ArrayBuffer for TypeScript compatibility
    const buffer = new ArrayBuffer(encrypted.byteLength);
    new Uint8Array(buffer).set(encrypted);
    await writable.write(buffer);
    await writable.close();

    return filename;
  }

  async measureStore(
    id: string,
    data: Uint8Array,
    onMetrics?: (metrics: StoreMetrics) => void | Promise<void>
  ): Promise<string> {
    return measureStoreHelper(
      () => this.store(id, data),
      data.byteLength,
      onMetrics
    );
  }

  async retrieve(storagePath: string): Promise<Uint8Array> {
    if (!this.filesDirectory || !this.encryptionKey) {
      throw new Error('Storage not initialized');
    }

    const fileHandle = await this.filesDirectory.getFileHandle(storagePath);
    const file = await fileHandle.getFile();
    const encrypted = new Uint8Array(await file.arrayBuffer());

    return decrypt(encrypted, this.encryptionKey);
  }

  async measureRetrieve(
    storagePath: string,
    onMetrics?: (metrics: RetrieveMetrics) => void | Promise<void>
  ): Promise<Uint8Array> {
    return measureRetrieveHelper(
      () => this.retrieve(storagePath),
      storagePath,
      onMetrics
    );
  }

  async delete(storagePath: string): Promise<void> {
    if (!this.filesDirectory) {
      throw new Error('Storage not initialized');
    }

    await this.filesDirectory.removeEntry(storagePath);
  }

  async exists(storagePath: string): Promise<boolean> {
    if (!this.filesDirectory) {
      throw new Error('Storage not initialized');
    }

    try {
      await this.filesDirectory.getFileHandle(storagePath);
      return true;
    } catch {
      return false;
    }
  }

  async getStorageUsed(): Promise<number> {
    if (!this.filesDirectory) {
      throw new Error('Storage not initialized');
    }

    let totalSize = 0;
    const iterator = getDirectoryEntries(this.filesDirectory);
    for await (const [, handle] of iterator) {
      if (isFileHandle(handle)) {
        const file = await handle.getFile();
        totalSize += file.size;
      }
    }
    return totalSize;
  }

  async clearAll(): Promise<void> {
    if (!this.filesDirectory) {
      throw new Error('Storage not initialized');
    }

    const entries: string[] = [];
    const iterator = getDirectoryEntries(this.filesDirectory);
    for await (const [name] of iterator) {
      entries.push(name);
    }

    for (const name of entries) {
      await this.filesDirectory.removeEntry(name);
    }
  }
}
