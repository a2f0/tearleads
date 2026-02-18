import type { BackupsRuntime } from '@tearleads/backups';
import { getCurrentInstanceId, getDatabaseAdapter } from '@/db';
import {
  createBackup,
  estimateBackupSize,
  getBackupInfo,
  restoreBackup
} from '@/db/backup';
import { getKeyManager } from '@/db/crypto';
import { getActiveInstance, getActiveInstanceId } from '@/db/instanceRegistry';
import { emitInstanceChange } from '@/hooks/useInstanceChange';
import { saveFile } from '@/lib/fileUtils';
import {
  deleteBackupFromStorage,
  getBackupStorageUsed,
  isBackupStorageSupported,
  listStoredBackups,
  readBackupFromStorage,
  saveBackupToStorage
} from '@/storage/backupStorage';
import {
  type FileStorage,
  getFileStorageForInstance,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

function formatBackupFilename(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `tearleads-backup-${year}-${month}-${day}-${hours}${minutes}${seconds}.tbu`;
}

async function getOrInitFileStorage(
  instanceId: string
): Promise<FileStorage | null> {
  if (isFileStorageInitialized(instanceId)) {
    return getFileStorageForInstance(instanceId);
  }

  const keyManager = getKeyManager();
  const encryptionKey = keyManager.getCurrentKey();
  if (!encryptionKey) {
    return null;
  }

  return initializeFileStorage(encryptionKey, instanceId);
}

export const clientBackupsRuntime: BackupsRuntime = {
  async estimateBackupSize(includeBlobs) {
    const instanceId = getCurrentInstanceId();
    if (!instanceId) {
      throw new Error('No active database instance');
    }

    const adapter = getDatabaseAdapter();
    const fileStorage = await getOrInitFileStorage(instanceId);

    const estimate = await estimateBackupSize(
      adapter,
      fileStorage,
      includeBlobs
    );
    return {
      blobCount: estimate.blobCount,
      blobTotalSize: estimate.blobTotalSize
    };
  },

  async createBackup({ password, includeBlobs, onProgress }) {
    const instanceId = getCurrentInstanceId();
    if (!instanceId) {
      throw new Error('No active database instance');
    }

    const adapter = getDatabaseAdapter();
    const fileStorage = await getOrInitFileStorage(instanceId);

    const instance = await getActiveInstance();
    const instanceName = instance?.name ?? 'Unknown';

    const backupData = await createBackup(adapter, fileStorage, {
      password,
      includeBlobs: includeBlobs && fileStorage !== null,
      instanceName,
      onProgress
    });

    const filename = formatBackupFilename(new Date());

    if (isBackupStorageSupported()) {
      await saveBackupToStorage(backupData, filename);
      return { filename, destination: 'storage' as const };
    }

    await saveFile(backupData, filename);
    return { filename, destination: 'download' as const };
  },

  getBackupInfo,
  restoreBackup,

  async refreshInstances() {
    const activeInstanceId = await getActiveInstanceId();
    emitInstanceChange(activeInstanceId);
  },

  isBackupStorageSupported,
  listStoredBackups,
  getBackupStorageUsed,
  readBackupFromStorage,
  deleteBackupFromStorage,
  saveFile
};
