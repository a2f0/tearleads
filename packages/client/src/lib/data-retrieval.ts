import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

export async function retrieveFileData(
  storagePath: string,
  currentInstanceId: string
): Promise<Uint8Array> {
  const db = getDatabase();
  const keyManager = getKeyManager();
  const encryptionKey = keyManager.getCurrentKey();
  if (!encryptionKey) throw new Error('Database not unlocked');

  if (!isFileStorageInitialized()) {
    await initializeFileStorage(encryptionKey, currentInstanceId);
  }

  const storage = getFileStorage();
  return storage.measureRetrieve(storagePath, createRetrieveLogger(db));
}
