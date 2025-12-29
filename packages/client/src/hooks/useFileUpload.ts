/**
 * Hook for uploading files to OPFS with encryption.
 */

import { and, eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { useCallback } from 'react';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { files } from '@/db/schema';
import { UnsupportedFileTypeError } from '@/lib/errors';
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

      // Detect MIME type from file content (magic bytes)
      const detectedType = await fileTypeFromBuffer(data);
      if (!detectedType) {
        throw new UnsupportedFileTypeError(file.name);
      }
      const mimeType = detectedType.mime;

      // Compute content hash for deduplication
      const contentHash = await computeContentHash(data);
      onProgress?.(40);

      // Check for duplicate
      const db = getDatabase();
      const existing = await db
        .select({ id: files.id })
        .from(files)
        .where(
          and(eq(files.contentHash, contentHash), eq(files.deleted, false))
        )
        .limit(1);

      if (existing.length > 0 && existing[0]) {
        onProgress?.(100);
        return { id: existing[0].id, isDuplicate: true };
      }

      // Store encrypted file
      const storage = getFileStorage();
      const id = crypto.randomUUID();
      onProgress?.(60);

      const storagePath = await storage.store(id, data);
      onProgress?.(80);

      // Insert metadata
      await db.insert(files).values({
        id,
        name: file.name,
        size: file.size,
        mimeType,
        uploadDate: new Date(),
        contentHash,
        storagePath
      });
      onProgress?.(100);

      return { id, isDuplicate: false };
    },
    []
  );

  return { uploadFile };
}
