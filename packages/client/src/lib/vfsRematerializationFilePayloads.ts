import { getCurrentInstanceId } from '@/db';
import { getKeyManagerForInstance } from '@/db/crypto';
import {
  getFileStorageForInstance,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

const ENCRYPTED_FILE_EXTENSION = '.enc';

function decodeBase64Binary(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
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
  const rowsWithPayload = fileRows.filter((row) => {
    if (row.deleted) {
      return false;
    }
    const payload = itemStateByItemId.get(row.id)?.encryptedPayload;
    return typeof payload === 'string' && payload.trim().length > 0;
  });

  if (rowsWithPayload.length === 0) {
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

  for (const row of rowsWithPayload) {
    const payload = itemStateByItemId.get(row.id)?.encryptedPayload;
    if (!payload) {
      continue;
    }
    const decoded = decodeBase64Binary(payload);
    if (!decoded) {
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
