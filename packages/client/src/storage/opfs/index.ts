/**
 * File storage adapters for encrypted file storage.
 * - OPFSStorage: Used on web/electron platforms using Origin Private File System
 * - CapacitorStorage: Used on iOS/Android using Capacitor Filesystem API
 * Supports multi-instance with namespaced directories.
 */

import { Capacitor } from '@capacitor/core';
import { CapacitorStorage } from './CapacitorStorage';
import { OPFSStorage } from './OPFSStorage';
import type { FileStorage } from './types';
import { getFilesDirectory } from './types';

export { createRetrieveLogger, createStoreLogger } from './metrics';
// Re-export types and utilities
export type { FileStorage, RetrieveMetrics, StoreMetrics } from './types';

/**
 * Determine which storage adapter to use based on platform.
 */
function shouldUseCapacitorStorage(): boolean {
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android';
}

// Map of instanceId -> FileStorage for multi-instance support
const storageInstances = new Map<string, FileStorage>();

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
 * Get the file storage instance for a specific instance.
 * Alias retained for existing imports; always requires an explicit instanceId.
 */
export function getFileStorage(instanceId: string): FileStorage {
  return getFileStorageForInstance(instanceId);
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
    return existing;
  }

  // Select storage adapter based on platform
  const storage = shouldUseCapacitorStorage()
    ? new CapacitorStorage(instanceId)
    : new OPFSStorage(instanceId);

  await storage.initialize(encryptionKey);
  storageInstances.set(instanceId, storage);
  return storage;
}

/**
 * Check if file storage is initialized for an instance.
 * @param instanceId The instance ID to check
 */
export function isFileStorageInitialized(instanceId: string): boolean {
  return storageInstances.has(instanceId);
}

/**
 * Get file storage for instance, initializing it when needed.
 * @param encryptionKey The encryption key
 * @param instanceId The instance ID
 */
export async function getOrInitializeFileStorage(
  encryptionKey: Uint8Array,
  instanceId: string
): Promise<FileStorage> {
  if (isFileStorageInitialized(instanceId)) {
    return getFileStorageForInstance(instanceId);
  }
  return initializeFileStorage(encryptionKey, instanceId);
}

/**
 * Clear the file storage instance for a specific instance.
 * @param instanceId The instance ID to clear
 */
export function clearFileStorageForInstance(instanceId: string): void {
  storageInstances.delete(instanceId);
}

/**
 * Clear all file storage instances (for testing or reset).
 */
export function clearFileStorageInstance(): void {
  storageInstances.clear();
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
