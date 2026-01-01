/**
 * OPFS (Origin Private File System) storage adapter for encrypted file storage.
 * Used on web platforms to persist files across browser sessions.
 * Supports multi-instance with namespaced directories.
 */

import { decrypt, encrypt, importKey } from '@/db/crypto/web-crypto';

/**
 * Get the directory name for an instance.
 */
function getFilesDirectory(instanceId: string): string {
  return `rapid-files-${instanceId}`;
}

export interface FileStorage {
  instanceId: string;
  initialize(encryptionKey: Uint8Array): Promise<void>;
  store(id: string, data: Uint8Array): Promise<string>;
  retrieve(storagePath: string): Promise<Uint8Array>;
  delete(storagePath: string): Promise<void>;
  exists(storagePath: string): Promise<boolean>;
  getStorageUsed(): Promise<number>;
  clearAll(): Promise<void>;
}

class OPFSStorage implements FileStorage {
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

// Map of instanceId -> FileStorage for multi-instance support
const storageInstances = new Map<string, FileStorage>();

// Track current instance ID
let currentStorageInstanceId: string | null = null;

/**
 * Get the file storage instance for a specific instance.
 * @param instanceId The instance ID
 */
export function getFileStorageForInstance(instanceId: string): FileStorage {
  const storage = storageInstances.get(instanceId);
  if (!storage) {
    throw new Error(
      `File storage not initialized for instance ${instanceId}. Call initializeFileStorage first.`
    );
  }
  return storage;
}

/**
 * Get the file storage instance for the current instance.
 * Must call initializeFileStorage first.
 */
export function getFileStorage(): FileStorage {
  if (!currentStorageInstanceId) {
    throw new Error(
      'No current file storage instance. Call initializeFileStorage first.'
    );
  }
  return getFileStorageForInstance(currentStorageInstanceId);
}

/**
 * Initialize the file storage with an encryption key.
 * @param encryptionKey The encryption key
 * @param instanceId The instance ID
 */
export async function initializeFileStorage(
  encryptionKey: Uint8Array,
  instanceId: string
): Promise<FileStorage> {
  // Check if already initialized for this instance
  const existing = storageInstances.get(instanceId);
  if (existing) {
    currentStorageInstanceId = instanceId;
    return existing;
  }

  const storage = new OPFSStorage(instanceId);
  await storage.initialize(encryptionKey);
  storageInstances.set(instanceId, storage);
  currentStorageInstanceId = instanceId;
  return storage;
}

/**
 * Check if file storage is initialized for an instance.
 * @param instanceId The instance ID to check
 */
export function isFileStorageInitialized(instanceId?: string): boolean {
  if (instanceId) {
    return storageInstances.has(instanceId);
  }
  return currentStorageInstanceId !== null;
}

/**
 * Clear the file storage instance for a specific instance.
 * @param instanceId The instance ID to clear
 */
export function clearFileStorageForInstance(instanceId: string): void {
  storageInstances.delete(instanceId);
  if (currentStorageInstanceId === instanceId) {
    currentStorageInstanceId = null;
  }
}

/**
 * Clear all file storage instances (for testing or reset).
 */
export function clearFileStorageInstance(): void {
  storageInstances.clear();
  currentStorageInstanceId = null;
}

/**
 * Delete the OPFS directory for a specific instance.
 * Use this when deleting an instance to clean up storage.
 * @param instanceId The instance ID to delete storage for
 */
export async function deleteFileStorageForInstance(
  instanceId: string
): Promise<void> {
  // Clear the storage instance first
  clearFileStorageForInstance(instanceId);

  // Delete the directory from OPFS
  if (!('storage' in navigator) || !navigator.storage.getDirectory) {
    return; // OPFS not supported
  }

  try {
    const rootDirectory = await navigator.storage.getDirectory();
    const directoryName = getFilesDirectory(instanceId);
    await rootDirectory.removeEntry(directoryName, { recursive: true });
  } catch {
    // Directory might not exist, ignore errors
  }
}

/**
 * Set the current storage instance ID.
 * @param instanceId The instance ID to set as current
 */
export function setCurrentStorageInstanceId(instanceId: string | null): void {
  currentStorageInstanceId = instanceId;
}

/**
 * Get the current storage instance ID.
 */
export function getCurrentStorageInstanceId(): string | null {
  return currentStorageInstanceId;
}
