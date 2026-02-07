/**
 * OPFS storage for the encrypted search index.
 * Each database instance has its own index directory.
 */

import { decrypt, encrypt, importKey } from '@rapid/shared';
import type { StoredSearchIndex } from './types';

const SEARCH_INDEX_DIRECTORY_PREFIX = 'rapid-search-index';
const INDEX_FILENAME = 'index.enc';

/** Current index format version for migrations */
export const INDEX_VERSION = 1;

function hasOpfsSupport(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    typeof navigator.storage.getDirectory === 'function'
  );
}

function getDirectoryName(instanceId: string): string {
  return `${SEARCH_INDEX_DIRECTORY_PREFIX}-${instanceId}`;
}

async function getSearchIndexDirectory(
  instanceId: string
): Promise<FileSystemDirectoryHandle> {
  if (!hasOpfsSupport()) {
    throw new Error('Search index storage is not supported on this platform');
  }

  const rootDirectory = await navigator.storage.getDirectory();
  return rootDirectory.getDirectoryHandle(getDirectoryName(instanceId), {
    create: true
  });
}

/**
 * Check if OPFS is available for search index storage.
 */
export function isSearchIndexStorageSupported(): boolean {
  return hasOpfsSupport();
}

/**
 * Save the search index to encrypted OPFS storage.
 */
export async function saveSearchIndexToStorage(
  instanceId: string,
  oramaData: string,
  documentCount: number,
  encryptionKey: Uint8Array
): Promise<void> {
  const directory = await getSearchIndexDirectory(instanceId);

  const storedIndex: StoredSearchIndex = {
    version: INDEX_VERSION,
    data: oramaData,
    documentCount,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(storedIndex));
  const cryptoKey = await importKey(encryptionKey);
  const encrypted = await encrypt(jsonBytes, cryptoKey);

  const fileHandle = await directory.getFileHandle(INDEX_FILENAME, {
    create: true
  });
  const writable = await fileHandle.createWritable();
  // Copy to plain ArrayBuffer for TypeScript compatibility
  const buffer = new ArrayBuffer(encrypted.byteLength);
  new Uint8Array(buffer).set(encrypted);
  await writable.write(buffer);
  await writable.close();
}

/**
 * Load the search index from encrypted OPFS storage.
 * Returns null if no index exists or if decryption fails.
 */
export async function loadSearchIndexFromStorage(
  instanceId: string,
  encryptionKey: Uint8Array
): Promise<StoredSearchIndex | null> {
  if (!hasOpfsSupport()) {
    return null;
  }

  try {
    const directory = await getSearchIndexDirectory(instanceId);
    const fileHandle = await directory.getFileHandle(INDEX_FILENAME);
    const file = await fileHandle.getFile();
    const encrypted = new Uint8Array(await file.arrayBuffer());

    const cryptoKey = await importKey(encryptionKey);
    const decrypted = await decrypt(encrypted, cryptoKey);
    const json = new TextDecoder().decode(decrypted);
    const stored: StoredSearchIndex = JSON.parse(json);

    // Version check for future migrations
    if (stored.version !== INDEX_VERSION) {
      console.warn(
        `Search index version mismatch: ${stored.version} vs ${INDEX_VERSION}`
      );
      return null;
    }

    return stored;
  } catch {
    // File doesn't exist or is corrupted
    return null;
  }
}

/**
 * Delete the search index for an instance.
 */
export async function deleteSearchIndexFromStorage(
  instanceId: string
): Promise<void> {
  if (!hasOpfsSupport()) {
    return;
  }

  try {
    const rootDirectory = await navigator.storage.getDirectory();
    const directoryName = getDirectoryName(instanceId);
    await rootDirectory.removeEntry(directoryName, { recursive: true });
  } catch {
    // Directory might not exist, ignore
  }
}

/**
 * Get the storage size used by the search index.
 */
export async function getSearchIndexStorageSize(
  instanceId: string
): Promise<number> {
  if (!hasOpfsSupport()) {
    return 0;
  }

  try {
    const directory = await getSearchIndexDirectory(instanceId);
    const fileHandle = await directory.getFileHandle(INDEX_FILENAME);
    const file = await fileHandle.getFile();
    return file.size;
  } catch {
    return 0;
  }
}
