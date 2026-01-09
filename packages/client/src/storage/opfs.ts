/**
 * File storage adapters for encrypted file storage.
 * - OPFSStorage: Used on web/electron platforms using Origin Private File System
 * - CapacitorStorage: Used on iOS/Android using Capacitor Filesystem API
 * Supports multi-instance with namespaced directories.
 */

import { Capacitor } from '@capacitor/core';
import type { Database } from '@/db';
import { logEvent } from '@/db/analytics';
import { decrypt, encrypt, importKey } from '@/db/crypto/web-crypto';

/**
 * Metrics from a file retrieval operation.
 */
export interface RetrieveMetrics {
  storagePath: string;
  durationMs: number;
  success: boolean;
  fileSize: number;
}

/**
 * Create a logger callback for file retrieval metrics.
 * Use this with measureRetrieve() to log decryption times to analytics.
 */
export function createRetrieveLogger(
  db: Database
): (metrics: RetrieveMetrics) => Promise<void> {
  return async (metrics: RetrieveMetrics) => {
    try {
      await logEvent(db, 'file_decrypt', metrics.durationMs, metrics.success);
    } catch (err) {
      // Don't let logging errors affect the main operation
      console.warn('Failed to log file_decrypt analytics event:', err);
    }
  };
}

/**
 * Shared helper to measure retrieve operations.
 * Used by both OPFSStorage and CapacitorStorage.
 */
async function measureRetrieveHelper(
  retrieveFn: () => Promise<Uint8Array>,
  storagePath: string,
  onMetrics?: (metrics: RetrieveMetrics) => void | Promise<void>
): Promise<Uint8Array> {
  const startTime = performance.now();
  let success = true;
  let fileSize = 0;

  try {
    const data = await retrieveFn();
    fileSize = data.byteLength;
    return data;
  } catch (error) {
    success = false;
    throw error;
  } finally {
    const durationMs = performance.now() - startTime;
    if (onMetrics) {
      // Fire and forget - don't block on metrics callback
      Promise.resolve(
        onMetrics({ storagePath, durationMs, success, fileSize })
      ).catch((err) => {
        // Don't block on callback errors, but log for debugging
        console.warn('onMetrics callback failed in measureRetrieve:', err);
      });
    }
  }
}

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
  measureRetrieve(
    storagePath: string,
    onMetrics?: (metrics: RetrieveMetrics) => void | Promise<void>
  ): Promise<Uint8Array>;
  delete(storagePath: string): Promise<void>;
  exists(storagePath: string): Promise<boolean>;
  getStorageUsed(): Promise<number>;
  clearAll(): Promise<void>;
}

interface FileSystemDirectoryEntriesHandle
  extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

function hasDirectoryEntries(
  directory: FileSystemDirectoryHandle
): directory is FileSystemDirectoryEntriesHandle {
  return 'entries' in directory;
}

function getDirectoryEntries(
  directory: FileSystemDirectoryHandle
): AsyncIterableIterator<[string, FileSystemHandle]> {
  if (!hasDirectoryEntries(directory)) {
    throw new Error('OPFS entries() is not supported in this environment');
  }
  return directory.entries();
}

function isFileHandle(
  handle: FileSystemHandle
): handle is FileSystemFileHandle {
  return handle.kind === 'file';
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

/**
 * Capacitor Filesystem-based storage for iOS/Android.
 * Uses the app's Library directory which is hidden from the Files app
 * but still persists across app updates and is backed up.
 */
class CapacitorStorage implements FileStorage {
  public instanceId: string;
  private encryptionKey: CryptoKey | null = null;
  private filesDirectory: string;
  private Filesystem: typeof import('@capacitor/filesystem').Filesystem | null =
    null;
  private Directory: typeof import('@capacitor/filesystem').Directory | null =
    null;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
    this.filesDirectory = getFilesDirectory(instanceId);
  }

  async initialize(encryptionKey: Uint8Array): Promise<void> {
    // Dynamically import Capacitor Filesystem to avoid loading on web
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    this.Filesystem = Filesystem;
    this.Directory = Directory;

    try {
      await this.Filesystem.mkdir({
        path: this.filesDirectory,
        directory: this.Directory.Library,
        recursive: true
      });
    } catch {
      // Directory might already exist, ignore error
    }

    this.encryptionKey = await importKey(encryptionKey);
  }

  async store(id: string, data: Uint8Array): Promise<string> {
    if (!this.Filesystem || !this.Directory || !this.encryptionKey) {
      throw new Error('Storage not initialized');
    }

    const encrypted = await encrypt(data, this.encryptionKey);
    const filename = `${id}.enc`;
    const filePath = `${this.filesDirectory}/${filename}`;

    // Convert to base64 in chunks to avoid stack overflow
    const CHUNK_SIZE = 0x8000; // 32k characters
    let binary = '';
    for (let i = 0; i < encrypted.length; i += CHUNK_SIZE) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(encrypted.subarray(i, i + CHUNK_SIZE))
      );
    }
    const base64Data = btoa(binary);

    await this.Filesystem.writeFile({
      path: filePath,
      data: base64Data,
      directory: this.Directory.Library
    });

    return filename;
  }

  async retrieve(storagePath: string): Promise<Uint8Array> {
    if (!this.Filesystem || !this.Directory || !this.encryptionKey) {
      throw new Error('Storage not initialized');
    }

    const filePath = `${this.filesDirectory}/${storagePath}`;
    const result = await this.Filesystem.readFile({
      path: filePath,
      directory: this.Directory.Library
    });

    // Convert base64 back to Uint8Array
    if (typeof result.data !== 'string') {
      throw new Error('Unexpected file data type from Capacitor Filesystem');
    }
    const binary = atob(result.data);
    const encrypted = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      encrypted[i] = binary.charCodeAt(i);
    }

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
    if (!this.Filesystem || !this.Directory) {
      throw new Error('Storage not initialized');
    }

    const filePath = `${this.filesDirectory}/${storagePath}`;
    await this.Filesystem.deleteFile({
      path: filePath,
      directory: this.Directory.Library
    });
  }

  async exists(storagePath: string): Promise<boolean> {
    if (!this.Filesystem || !this.Directory) {
      throw new Error('Storage not initialized');
    }

    try {
      const filePath = `${this.filesDirectory}/${storagePath}`;
      await this.Filesystem.stat({
        path: filePath,
        directory: this.Directory.Library
      });
      return true;
    } catch {
      return false;
    }
  }

  async getStorageUsed(): Promise<number> {
    if (!this.Filesystem || !this.Directory) {
      throw new Error('Storage not initialized');
    }

    try {
      const result = await this.Filesystem.readdir({
        path: this.filesDirectory,
        directory: this.Directory.Library
      });

      let totalSize = 0;
      for (const file of result.files) {
        if (file.type === 'file') {
          const stat = await this.Filesystem.stat({
            path: `${this.filesDirectory}/${file.name}`,
            directory: this.Directory.Library
          });
          totalSize += stat.size;
        }
      }
      return totalSize;
    } catch {
      return 0;
    }
  }

  async clearAll(): Promise<void> {
    if (!this.Filesystem || !this.Directory) {
      throw new Error('Storage not initialized');
    }

    try {
      const result = await this.Filesystem.readdir({
        path: this.filesDirectory,
        directory: this.Directory.Library
      });

      for (const file of result.files) {
        if (file.type === 'file') {
          await this.Filesystem.deleteFile({
            path: `${this.filesDirectory}/${file.name}`,
            directory: this.Directory.Library
          });
        }
      }
    } catch {
      // Directory might not exist, ignore
    }
  }
}

/**
 * Determine which storage adapter to use based on platform.
 */
function shouldUseCapacitorStorage(): boolean {
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android';
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
 * Automatically selects the appropriate storage adapter based on platform:
 * - iOS/Android: Uses Capacitor Filesystem API
 * - Web/Electron: Uses OPFS (Origin Private File System)
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

  // Select storage adapter based on platform
  const storage = shouldUseCapacitorStorage()
    ? new CapacitorStorage(instanceId)
    : new OPFSStorage(instanceId);

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
  clearFileStorageForInstance(instanceId);

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
