import { getCurrentInstanceId } from '@/db';
import { getKeyManagerForInstance } from '@/db/crypto';
import {
  getFileStorageForInstance,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import { logStore } from '@/stores/logStore';

const ENCRYPTED_FILE_EXTENSION = '.enc';

function reportMaterializationError(message: string, details: string): void {
  logStore.error(message, details);
  console.error(message, details);
}

function decodeBase64Binary(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = trimmed
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const missingPadding = normalized.length % 4;
  const padded =
    missingPadding === 0
      ? normalized
      : `${normalized}${'='.repeat(4 - missingPadding)}`;

  if (typeof globalThis.atob !== 'function') {
    return null;
  }

  try {
    const decoded = globalThis.atob(padded);
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function materializeFilePayloadsToStorage(
  fileRows: Array<{
    id: string;
    storagePath: string;
    deleted: boolean;
  }>,
  itemStateByItemId: ReadonlyMap<
    string,
    { encryptedPayload: string | null; updatedAtMs: number; deleted: boolean }
  >
): Promise<void> {
  const activeRows = fileRows.filter((row) => !row.deleted);
  if (activeRows.length === 0) {
    return;
  }

  const instanceId = getCurrentInstanceId();
  if (!instanceId) {
    throw new Error(
      'Cannot rematerialize file payloads without an active instance'
    );
  }

  const encryptionKey = getKeyManagerForInstance(instanceId).getCurrentKey();
  if (!encryptionKey) {
    throw new Error(
      'Cannot rematerialize file payloads while database key is unavailable'
    );
  }

  if (!isFileStorageInitialized(instanceId)) {
    await initializeFileStorage(encryptionKey, instanceId);
  }

  const storage = getFileStorageForInstance(instanceId);

  for (const row of activeRows) {
    const payload = itemStateByItemId.get(row.id)?.encryptedPayload;
    if (typeof payload !== 'string' || payload.trim().length === 0) {
      reportMaterializationError(
        'VFS rematerialization payload missing',
        `itemId=${row.id}, storagePath=${row.storagePath}`
      );
      continue;
    }
    const decoded = decodeBase64Binary(payload);
    if (!decoded) {
      reportMaterializationError(
        'VFS rematerialization payload decode failed',
        `itemId=${row.id}, storagePath=${row.storagePath}`
      );
      continue;
    }
    const storageId = row.storagePath.endsWith(ENCRYPTED_FILE_EXTENSION)
      ? row.storagePath.slice(0, -ENCRYPTED_FILE_EXTENSION.length)
      : row.storagePath;
    try {
      row.storagePath = await storage.store(storageId, decoded);
    } finally {
      decoded.fill(0);
    }
  }
}
