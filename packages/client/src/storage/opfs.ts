/**
 * OPFS (Origin Private File System) storage adapter for encrypted file storage.
 * Used on web platforms to persist files across browser sessions.
 */

import { decrypt, encrypt, importKey } from '@/db/crypto/web-crypto';

const FILES_DIRECTORY = 'rapid-files';

export interface FileStorage {
  initialize(encryptionKey: Uint8Array): Promise<void>;
  store(id: string, data: Uint8Array): Promise<string>;
  retrieve(storagePath: string): Promise<Uint8Array>;
  delete(storagePath: string): Promise<void>;
  exists(storagePath: string): Promise<boolean>;
  getStorageUsed(): Promise<number>;
  clearAll(): Promise<void>;
}

class OPFSStorage implements FileStorage {
  private rootDirectory: FileSystemDirectoryHandle | null = null;
  private filesDirectory: FileSystemDirectoryHandle | null = null;
  private encryptionKey: CryptoKey | null = null;

  async initialize(encryptionKey: Uint8Array): Promise<void> {
    if (!('storage' in navigator) || !navigator.storage.getDirectory) {
      throw new Error('OPFS is not supported in this browser');
    }

    this.rootDirectory = await navigator.storage.getDirectory();
    this.filesDirectory = await this.rootDirectory.getDirectoryHandle(
      FILES_DIRECTORY,
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
    // Copy to plain ArrayBuffer for OPFS compatibility
    const buffer = new ArrayBuffer(encrypted.byteLength);
    new Uint8Array(buffer).set(encrypted);
    await writable.write(buffer);
    await writable.close();

    return filename;
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
    // Use entries() which returns AsyncIterableIterator
    const iterator = (
      this.filesDirectory as unknown as {
        entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
      }
    ).entries();
    for await (const [, handle] of iterator) {
      if (handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile();
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
    // Use entries() which returns AsyncIterableIterator
    const iterator = (
      this.filesDirectory as unknown as {
        entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
      }
    ).entries();
    for await (const [name] of iterator) {
      entries.push(name);
    }

    for (const name of entries) {
      await this.filesDirectory.removeEntry(name);
    }
  }
}

let storageInstance: FileStorage | null = null;

/**
 * Get the file storage instance.
 * Must call initializeFileStorage first.
 */
export function getFileStorage(): FileStorage {
  if (!storageInstance) {
    throw new Error(
      'File storage not initialized. Call initializeFileStorage first.'
    );
  }
  return storageInstance;
}

/**
 * Initialize the file storage with an encryption key.
 */
export async function initializeFileStorage(
  encryptionKey: Uint8Array
): Promise<FileStorage> {
  if (storageInstance) {
    return storageInstance;
  }

  const storage = new OPFSStorage();
  await storage.initialize(encryptionKey);
  storageInstance = storage;
  return storage;
}

/**
 * Check if file storage is initialized.
 */
export function isFileStorageInitialized(): boolean {
  return storageInstance !== null;
}

/**
 * Clear the file storage instance (for testing or reset).
 */
export function clearFileStorageInstance(): void {
  storageInstance = null;
}
