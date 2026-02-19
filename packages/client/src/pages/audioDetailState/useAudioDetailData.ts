/**
 * Hook for AudioDetail data fetching and file operations.
 */

import { and, eq, like } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { type AudioMetadata, extractAudioMetadata } from '@/lib/audioMetadata';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized,
  type RetrieveMetrics
} from '@/storage/opfs';

export interface AudioInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
}

interface UseAudioDetailDataOptions {
  id: string | undefined;
}

export function useAudioDetailData({ id }: UseAudioDetailDataOptions) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const [audio, setAudio] = useState<AudioInfo | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track all created blob URLs to revoke on unmount.
  const urlsToRevoke = useRef<string[]>([]);
  const objectUrlRef = useRef<string | null>(null);
  const currentTrackRef = useRef<{ id: string } | null>(null);

  // Helper to retrieve and decrypt file data from storage
  const retrieveFileData = useCallback(
    async (
      storagePath: string,
      onMetrics?: (metrics: RetrieveMetrics) => void | Promise<void>
    ): Promise<Uint8Array> => {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      return storage.measureRetrieve(storagePath, onMetrics);
    },
    [currentInstanceId]
  );

  const fetchAudio = useCallback(async () => {
    if (!isUnlocked || !id) return;

    setLoading(true);
    setError(null);
    setMetadata(null);

    try {
      const db = getDatabase();

      const result = await db
        .select({
          id: files.id,
          name: files.name,
          size: files.size,
          mimeType: files.mimeType,
          uploadDate: files.uploadDate,
          storagePath: files.storagePath,
          thumbnailPath: files.thumbnailPath
        })
        .from(files)
        .where(
          and(
            eq(files.id, id),
            like(files.mimeType, 'audio/%'),
            eq(files.deleted, false)
          )
        )
        .limit(1);

      const row = result[0];
      if (!row) {
        setError('Audio file not found');
        return;
      }

      const audioInfo: AudioInfo = {
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath
      };
      setAudio(audioInfo);

      // Load audio data and create object URL
      const logger = createRetrieveLogger(db);
      const data = await retrieveFileData(audioInfo.storagePath, logger);
      const metadataResult = await extractAudioMetadata(
        data,
        audioInfo.mimeType
      );
      setMetadata(metadataResult);
      // Copy to ArrayBuffer - required because Uint8Array<ArrayBufferLike> is not
      // assignable to BlobPart in strict TypeScript (SharedArrayBuffer incompatibility)
      const buffer = new ArrayBuffer(data.byteLength);
      new Uint8Array(buffer).set(data);
      const blob = new Blob([buffer], { type: audioInfo.mimeType });
      const url = URL.createObjectURL(blob);
      urlsToRevoke.current.push(url);
      objectUrlRef.current = url;
      setObjectUrl(url);

      // Load thumbnail if available
      if (audioInfo.thumbnailPath) {
        try {
          const thumbData = await retrieveFileData(
            audioInfo.thumbnailPath,
            logger
          );
          const thumbBuffer = new ArrayBuffer(thumbData.byteLength);
          new Uint8Array(thumbBuffer).set(thumbData);
          const thumbBlob = new Blob([thumbBuffer], { type: 'image/jpeg' });
          const thumbUrl = URL.createObjectURL(thumbBlob);
          urlsToRevoke.current.push(thumbUrl);
          setThumbnailUrl(thumbUrl);
        } catch (err) {
          console.warn('Failed to load thumbnail:', err);
        }
      }
    } catch (err) {
      console.error('Failed to fetch audio:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, id, retrieveFileData]);

  useEffect(() => {
    if (isUnlocked && id) {
      fetchAudio();
    }
  }, [isUnlocked, id, fetchAudio]);

  // Only revoke URLs on unmount, not on URL changes.
  useEffect(() => {
    return () => {
      const currentlyPlayingUrl =
        currentTrackRef.current?.id === id ? objectUrlRef.current : null;
      for (const url of urlsToRevoke.current) {
        if (url !== currentlyPlayingUrl) {
          URL.revokeObjectURL(url);
        }
      }
    };
  }, [id]);

  const setCurrentTrack = useCallback((track: { id: string } | null) => {
    currentTrackRef.current = track;
  }, []);

  const updateAudioName = useCallback((newName: string) => {
    setAudio((prev) => (prev ? { ...prev, name: newName } : prev));
  }, []);

  return {
    audio,
    objectUrl,
    thumbnailUrl,
    metadata,
    loading,
    error,
    isUnlocked,
    isLoading,
    setError,
    retrieveFileData,
    setCurrentTrack,
    updateAudioName
  };
}
