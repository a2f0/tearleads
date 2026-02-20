/**
 * Hook for uploading files to OPFS with encryption.
 *
 * When the 'vfsSecureUpload' feature flag is enabled and the secure facade
 * is available, uploads will use end-to-end encryption through the secure
 * pipeline. Otherwise, falls back to local OPFS storage with optional
 * server registration.
 */

import { and, eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { useCallback } from 'react';
import {
  useVfsOrchestratorInstance,
  useVfsSecureFacade
} from '@/contexts/VfsOrchestratorContext';
import { getDatabase } from '@/db';
import { logEvent } from '@/db/analytics';
import { getCurrentInstanceId, getKeyManager } from '@/db/crypto';
import { files, vfsRegistry } from '@/db/schema';
import { api } from '@/lib/api';
import { isLoggedIn, readStoredAuth } from '@/lib/authStorage';
import { UnsupportedFileTypeError } from '@/lib/errors';
import { getFeatureFlagValue } from '@/lib/featureFlags';
import { computeContentHash, readFileAsUint8Array } from '@/lib/fileUtils';
import { generateThumbnail, isThumbnailSupported } from '@/lib/thumbnail';
import {
  createStoreLogger,
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import { generateSessionKey, wrapSessionKey } from './useVfsKeys';

export interface UploadResult {
  id: string;
  isDuplicate: boolean;
}

/** Default expiration for staged blobs (7 days) */
const DEFAULT_BLOB_EXPIRY_DAYS = 7;

/**
 * Convert a Uint8Array to a ReadableStream for the secure pipeline.
 */
function createStreamFromData(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    }
  });
}

export function useFileUpload() {
  const secureFacade = useVfsSecureFacade();
  const orchestrator = useVfsOrchestratorInstance();

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
      let mimeType: string;
      if (detectedType) {
        mimeType = detectedType.mime;
      } else if (file.type.startsWith('text/')) {
        // Text files don't have magic bytes, so fall back to browser-provided MIME type
        mimeType = file.type;
      } else {
        throw new UnsupportedFileTypeError(file.name);
      }

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

      let encryptedSessionKey: string | null = null;
      if (isLoggedIn()) {
        try {
          const sessionKey = generateSessionKey();
          encryptedSessionKey = await wrapSessionKey(sessionKey);
        } catch (err) {
          console.warn('Failed to wrap file session key:', err);
        }
      }

      // Register in local VFS registry (device-first)
      const auth = readStoredAuth();

      await db.insert(vfsRegistry).values({
        id,
        objectType: 'file',
        ownerId: auth.user?.id ?? null,
        encryptedSessionKey,
        createdAt: new Date()
      });

      // Use secure facade for encrypted server upload when available
      let serverUploadSucceeded = false;
      if (
        isLoggedIn() &&
        getFeatureFlagValue('vfsSecureUpload') &&
        secureFacade &&
        orchestrator
      ) {
        try {
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + DEFAULT_BLOB_EXPIRY_DAYS);

          await secureFacade.stageAttachEncryptedBlobAndPersist({
            itemId: id,
            blobId: crypto.randomUUID(),
            contentType: mimeType,
            stream: createStreamFromData(data),
            expiresAt: expiresAt.toISOString()
          });

          // Flush queued operations to ensure data reaches the server.
          // stageAttachEncryptedBlobAndPersist only queues operations locally;
          // flushAll sends them over the network.
          await orchestrator.flushAll();

          serverUploadSucceeded = true;
        } catch (err) {
          console.warn('Failed to upload via secure facade:', err);
          // Fall through to legacy registration if secure upload fails
        }
      }

      // Legacy registration path - used when secure upload is not enabled or fails
      if (
        !serverUploadSucceeded &&
        isLoggedIn() &&
        getFeatureFlagValue('vfsServerRegistration') &&
        encryptedSessionKey
      ) {
        try {
          await api.vfs.register({
            id,
            objectType: 'file',
            encryptedSessionKey
          });
        } catch (err) {
          console.warn('Failed to register file on server:', err);
        }
      }

      onProgress?.(100);

      return { id, isDuplicate: false };
    },
    [secureFacade, orchestrator]
  );

  return { uploadFile };
}
