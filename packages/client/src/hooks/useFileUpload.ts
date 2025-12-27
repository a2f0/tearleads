/**
 * Hook for uploading files to OPFS with encryption.
 */

import { useCallback } from 'react';
import { getDatabaseAdapter } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { computeContentHash, readFileAsUint8Array } from '@/lib/file-utils';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

export interface UploadResult {
  id: string;
  isDuplicate: boolean;
}

interface FileRow {
  id: string;
}

export function useFileUpload() {
  const uploadFile = useCallback(
    async (
      file: File,
      onProgress?: (progress: number) => void
    ): Promise<UploadResult> => {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) {
        throw new Error('Database not unlocked');
      }

      // Initialize file storage if needed
      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey);
      }

      // Read file data
      const data = await readFileAsUint8Array(file);
      onProgress?.(20);

      // Compute content hash for deduplication
      const contentHash = await computeContentHash(data);
      onProgress?.(40);

      // Check for duplicate
      const adapter = getDatabaseAdapter();
      const existing = await adapter.execute(
        'SELECT id FROM files WHERE content_hash = ? AND deleted = 0',
        [contentHash]
      );

      if (existing.rows.length > 0) {
        const existingRow = existing.rows[0] as unknown as FileRow;
        onProgress?.(100);
        return { id: existingRow.id, isDuplicate: true };
      }

      // Store encrypted file
      const storage = getFileStorage();
      const id = crypto.randomUUID();
      onProgress?.(60);

      const storagePath = await storage.store(id, data);
      onProgress?.(80);

      // Insert metadata
      await adapter.execute(
        `INSERT INTO files (id, name, size, mime_type, upload_date, content_hash, storage_path)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          file.name,
          file.size,
          file.type || 'application/octet-stream',
          Date.now(),
          contentHash,
          storagePath
        ]
      );
      onProgress?.(100);

      return { id, isDuplicate: false };
    },
    []
  );

  return { uploadFile };
}
