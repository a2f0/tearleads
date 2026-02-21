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
import {
  computeContentHashStreaming,
  createStreamFromFile,
  readFileAsUint8Array,
  readMagicBytes
} from '@/lib/fileUtils';
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

      // Detect MIME type from file content (magic bytes only - memory efficient)
      const magicBytes = await readMagicBytes(file);
      const detectedType = await fileTypeFromBuffer(magicBytes);
      let mimeType: string;
      if (detectedType) {
        mimeType = detectedType.mime;
      } else if (file.type.startsWith('text/')) {
        mimeType = file.type;
      } else {
        throw new UnsupportedFileTypeError(file.name);
      }
      onProgress?.(10);

      const db = getDatabase();
      const storage = getFileStorage();
      const id = crypto.randomUUID();
      const contentHash = await computeContentHashStreaming(
        createStreamFromFile(file)
      );
      let storagePath: string;
      let thumbnailPath: string | null = null;

      // Compute hash from a stream first so duplicate detection does not
      // require buffering the entire file in memory.
      onProgress?.(30);

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

      // Scope full-file buffers to local persistence work so large payloads can
      // be collected before secure network staging/flush begins.
      {
        // Read file data only after deduplication miss.
        const data = await readFileAsUint8Array(file);
        onProgress?.(40);

        // Store encrypted file
        onProgress?.(50);
        storagePath = await storage.measureStore(
          id,
          data,
          createStoreLogger(db)
        );
        onProgress?.(65);

        // Generate thumbnail for supported types (images and audio with cover art)
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
      }

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

      const secureUploadEnabled =
        isLoggedIn() && getFeatureFlagValue('vfsSecureUpload');

      // Use secure facade for encrypted server upload when enabled.
      // Fail closed when secure mode is enabled but runtime dependencies fail.
      let serverUploadSucceeded = false;
      if (secureUploadEnabled) {
        const secureUploadStartTime = performance.now();
        let secureUploadFailStage:
          | 'orchestrator_unavailable'
          | 'stage_attach'
          | 'flush'
          | 'unknown'
          | null = null;

        try {
          if (!secureFacade || !orchestrator) {
            secureUploadFailStage = 'orchestrator_unavailable';
            throw new Error(
              'Secure upload is enabled but VFS secure orchestrator is not ready'
            );
          }

          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + DEFAULT_BLOB_EXPIRY_DAYS);

          // Stream directly from File for memory-efficient encrypted upload.
          // The secure pipeline processes chunks via callback without
          // accumulating ciphertext in memory.
          try {
            await secureFacade.stageAttachEncryptedBlobAndPersist({
              itemId: id,
              blobId: crypto.randomUUID(),
              contentType: mimeType,
              stream: createStreamFromFile(file),
              expiresAt: expiresAt.toISOString()
            });
          } catch (err) {
            secureUploadFailStage = 'stage_attach';
            throw new Error('Secure upload failed (stage_attach)', {
              cause: err
            });
          }

          // Flush queued operations to ensure data reaches the server.
          // stageAttachEncryptedBlobAndPersist only queues operations locally;
          // flushAll sends them over the network.
          try {
            await orchestrator.flushAll();
          } catch (err) {
            secureUploadFailStage = 'flush';
            throw new Error('Secure upload failed (flush)', { cause: err });
          }

          serverUploadSucceeded = true;
        } catch (err) {
          if (
            err instanceof Error &&
            err.message ===
              'Secure upload is enabled but VFS secure orchestrator is not ready'
          ) {
            throw err;
          }

          if (secureUploadFailStage === null) {
            secureUploadFailStage = 'unknown';
          }
          throw new Error(`Secure upload failed (${secureUploadFailStage})`, {
            cause: err
          });
        } finally {
          const durationMs = performance.now() - secureUploadStartTime;
          try {
            await logEvent(
              db,
              'vfs_secure_upload',
              durationMs,
              serverUploadSucceeded,
              {
                fileSize: file.size,
                mimeType,
                ...(secureUploadFailStage && {
                  failStage: secureUploadFailStage
                })
              }
            );
          } catch (err) {
            console.warn('Failed to log vfs_secure_upload event:', err);
          }
        }
      }

      // Legacy registration path - used when secure upload is not enabled.
      if (
        !secureUploadEnabled &&
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
