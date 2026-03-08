/**
 * Hook for files table data fetching and state management.
 */

import { asc, desc, eq, or } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files as filesTable } from '@/db/schema';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage
} from '@/storage/opfs';
import type {
  FileInfo,
  FileWithThumbnail,
  SortColumn,
  SortDirection
} from './types';

interface UseFilesTableDataResult {
  files: FileWithThumbnail[];
  setFiles: React.Dispatch<React.SetStateAction<FileWithThumbnail[]>>;
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  hasFetched: boolean;
  setHasFetched: React.Dispatch<React.SetStateAction<boolean>>;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  fetchFiles: () => Promise<void>;
  handleSortChange: (column: SortColumn) => void;
}

export function useFilesTableData(
  showDeleted: boolean,
  refreshToken: number | undefined
): UseFilesTableDataResult {
  const { isUnlocked, currentInstanceId } = useDatabaseContext();
  const [files, setFiles] = useState<FileWithThumbnail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('uploadDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const fetchedForInstanceRef = useRef<string | null>(null);

  const fetchFiles = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      const orderByColumn = {
        name: filesTable.name,
        size: filesTable.size,
        mimeType: filesTable.mimeType,
        uploadDate: filesTable.uploadDate
      }[sortColumn];

      const orderFn = sortDirection === 'asc' ? asc : desc;

      const whereClause = showDeleted
        ? or(eq(filesTable.deleted, false), eq(filesTable.deleted, true))
        : eq(filesTable.deleted, false);

      const result = await db
        .select({
          id: filesTable.id,
          name: filesTable.name,
          size: filesTable.size,
          mimeType: filesTable.mimeType,
          uploadDate: filesTable.uploadDate,
          storagePath: filesTable.storagePath,
          thumbnailPath: filesTable.thumbnailPath,
          deleted: filesTable.deleted
        })
        .from(filesTable)
        .where(whereClause)
        .orderBy(orderFn(orderByColumn));

      const fileList: FileInfo[] = result.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath,
        deleted: row.deleted
      }));

      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      await initializeFileStorage(encryptionKey, currentInstanceId);

      const storage = getFileStorage();
      const logger = createRetrieveLogger(db);
      const filesWithThumbnails: FileWithThumbnail[] = await Promise.all(
        fileList.map(async (file) => {
          if (!file.thumbnailPath) {
            return { ...file, thumbnailUrl: null };
          }
          try {
            const data = await storage.measureRetrieve(
              file.thumbnailPath,
              logger
            );
            const blob = new Blob([new Uint8Array(data)], {
              type: 'image/jpeg'
            });
            const thumbnailUrl = URL.createObjectURL(blob);
            return { ...file, thumbnailUrl };
          } catch (err) {
            console.warn(`Failed to load thumbnail for ${file.name}:`, err);
            return { ...file, thumbnailUrl: null };
          }
        })
      );

      setFiles(filesWithThumbnails);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch files:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, sortColumn, sortDirection, showDeleted, currentInstanceId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: files and hasFetched intentionally excluded
  useEffect(() => {
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForInstanceRef.current !== currentInstanceId);

    if (needsFetch) {
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
        fetchedForInstanceRef.current !== null
      ) {
        for (const file of files) {
          if (file.thumbnailUrl) {
            URL.revokeObjectURL(file.thumbnailUrl);
          }
        }
        setFiles([]);
        setError(null);
      }

      fetchedForInstanceRef.current = currentInstanceId;

      const timeoutId = setTimeout(() => {
        fetchFiles();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [isUnlocked, loading, hasFetched, currentInstanceId, fetchFiles]);

  useEffect(() => {
    if (refreshToken !== undefined && refreshToken > 0 && isUnlocked) {
      fetchFiles();
    }
  }, [refreshToken, isUnlocked, fetchFiles]);

  useEffect(() => {
    return () => {
      for (const file of files) {
        if (file.thumbnailUrl) {
          URL.revokeObjectURL(file.thumbnailUrl);
        }
      }
    };
  }, [files]);

  const handleSortChange = useCallback((column: SortColumn) => {
    setSortColumn((prevColumn) => {
      if (prevColumn === column) {
        setSortDirection((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevColumn;
      }
      setSortDirection('asc');
      return column;
    });
    setHasFetched(false);
  }, []);

  return {
    files,
    setFiles,
    loading,
    error,
    setError,
    hasFetched,
    setHasFetched,
    sortColumn,
    sortDirection,
    fetchFiles,
    handleSortChange
  };
}
