/**
 * Hook for uploading files to OPFS with encryption.
 */

import { and, eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { useCallback } from 'react';
import { getDatabase } from '@/db';
import { logEvent } from '@/db/analytics';
import { getCurrentInstanceId, getKeyManager } from '@/db/crypto';
import { files } from '@/db/schema';
import { UnsupportedFileTypeError } from '@/lib/errors';
import { computeContentHash, readFileAsUint8Array } from '@/lib/file-utils';
import { generateThumbnail, isThumbnailSupported } from '@/lib/thumbnail';
import {
  createStoreLogger,
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

      const instanceId = getCurrentInstanceId();
      if (!instanceId) {
        throw new Error('No active instance');
      }
      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, instanceId);
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
      onProgress?.(50);

      const storagePath = await storage.measureStore(
        id,
        data,
        createStoreLogger(db)
      );
      onProgress?.(65);

      // Generate thumbnail for supported types (images and audio with cover art)
      let thumbnailPath: string | null = null;
      if (isThumbnailSupported(mimeType)) {
        const thumbnailStartTime = performance.now();
        let thumbnailSuccess = false;
        try {
          const thumbnailData = await generateThumbnail(data, mimeType);
          if (thumbnailData) {
            const thumbnailId = `${id}-thumb`;
            thumbnailPath = await storage.store(thumbnailId, thumbnailData);
            thumbnailSuccess = true;
          }
        } catch (err) {
          console.warn(`Failed to generate thumbnail for ${file.name}:`, err);
          // Continue without thumbnail
        }
        const thumbnailDurationMs = performance.now() - thumbnailStartTime;
        try {
          await logEvent(
            db,
            'thumbnail_generation',
            thumbnailDurationMs,
            thumbnailSuccess
          );
        } catch (err) {
          // Don't let logging errors affect the main operation
          console.warn('Failed to log thumbnail_generation event:', err);
        }
      }
      onProgress?.(85);

      // Insert metadata
      await db.insert(files).values({
        id,
        name: file.name,
        size: file.size,
        mimeType,
        uploadDate: new Date(),
        contentHash,
        storagePath,
        thumbnailPath
      });
      onProgress?.(100);

      return { id, isDuplicate: false };
    },
    []
  );

  return { uploadFile };
}
