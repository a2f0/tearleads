/**
 * Types for file storage adapters.
 */

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
 * Metrics from a file store operation.
 */
export interface StoreMetrics {
  storagePath: string;
  durationMs: number;
  success: boolean;
  fileSize: number;
}

export interface FileStorage {
  instanceId: string;
  initialize(encryptionKey: Uint8Array): Promise<void>;
  store(id: string, data: Uint8Array): Promise<string>;
  measureStore(
    id: string,
    data: Uint8Array,
    onMetrics?: (metrics: StoreMetrics) => void | Promise<void>
  ): Promise<string>;
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

/**
 * Get the directory name for an instance.
 */
export function getFilesDirectory(instanceId: string): string {
  return `tearleads-files-${instanceId}`;
}
