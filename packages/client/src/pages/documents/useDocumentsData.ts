/**
 * Hook for fetching and managing documents data.
 */

import { and, desc, eq, like, or } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import type { DocumentInfo, DocumentWithUrl } from './documentTypes';

const PDF_MIME_TYPE = 'application/pdf';

interface UseDocumentsDataResult {
  documents: DocumentWithUrl[];
  setDocuments: React.Dispatch<React.SetStateAction<DocumentWithUrl[]>>;
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  hasFetched: boolean;
  setHasFetched: React.Dispatch<React.SetStateAction<boolean>>;
  fetchDocuments: () => Promise<void>;
}

export function useDocumentsData(
  showDeleted: boolean,
  refreshToken?: number
): UseDocumentsDataResult {
  const { isUnlocked, currentInstanceId } = useDatabaseContext();
  const [documents, setDocuments] = useState<DocumentWithUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchedForInstanceRef = useRef<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

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
          thumbnailPath: files.thumbnailPath,
          deleted: files.deleted
        })
        .from(files)
        .where(
          and(
            or(
              eq(files.mimeType, PDF_MIME_TYPE),
              like(files.mimeType, 'text/%')
            ),
            showDeleted ? undefined : eq(files.deleted, false)
          )
        )
        .orderBy(desc(files.uploadDate));

      const documentList: DocumentInfo[] = result.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath,
        deleted: row.deleted
      }));

      // Load thumbnails for documents that have them
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const documentsWithUrls: DocumentWithUrl[] = await Promise.all(
        documentList.map(async (doc) => {
          let thumbnailUrl: string | null = null;
          if (doc.thumbnailPath) {
            try {
              const data = await storage.retrieve(doc.thumbnailPath);
              const blob = new Blob([data.slice()], { type: 'image/jpeg' });
              thumbnailUrl = URL.createObjectURL(blob);
            } catch (err) {
              console.warn(`Failed to load thumbnail for ${doc.name}:`, err);
            }
          }
          return { ...doc, thumbnailUrl };
        })
      );

      setDocuments(documentsWithUrls);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch documents:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, currentInstanceId, showDeleted]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: documents and hasFetched intentionally excluded to prevent re-fetch loops
  useEffect(() => {
    // Check if we need to fetch for this instance
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForInstanceRef.current !== currentInstanceId);

    if (needsFetch) {
      // If instance changed, cleanup old thumbnail URLs first
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
        fetchedForInstanceRef.current !== null
      ) {
        for (const doc of documents) {
          if (doc.thumbnailUrl) {
            URL.revokeObjectURL(doc.thumbnailUrl);
          }
        }
        setDocuments([]);
        setError(null);
      }

      // Update ref before fetching to prevent re-entry
      fetchedForInstanceRef.current = currentInstanceId;

      // Defer fetch to next tick to ensure database singleton is updated
      const timeoutId = setTimeout(() => {
        fetchDocuments();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [isUnlocked, loading, hasFetched, currentInstanceId, fetchDocuments]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      for (const doc of documents) {
        if (doc.thumbnailUrl) {
          URL.revokeObjectURL(doc.thumbnailUrl);
        }
      }
    };
  }, [documents]);

  useEffect(() => {
    if (refreshToken === undefined || refreshToken === 0) return;
    setHasFetched(false);
  }, [refreshToken]);

  return {
    documents,
    setDocuments,
    loading,
    error,
    setError,
    hasFetched,
    setHasFetched,
    fetchDocuments
  };
}
