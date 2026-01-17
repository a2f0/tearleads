import { asc, desc, eq, or } from 'drizzle-orm';
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileIcon,
  FileText,
  Info,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudio } from '@/audio';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { RefreshButton } from '@/components/ui/refresh-button';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files as filesTable } from '@/db/schema';
import { useTypedTranslation } from '@/i18n';
import { retrieveFileData } from '@/lib/data-retrieval';
import { downloadFile } from '@/lib/file-utils';
import { useNavigateWithFrom } from '@/lib/navigation';
import { formatFileSize } from '@/lib/utils';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage
} from '@/storage/opfs';

interface FileInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
  deleted: boolean;
}

interface FileWithThumbnail extends FileInfo {
  thumbnailUrl: string | null;
}

type SortColumn = 'name' | 'size' | 'mimeType' | 'uploadDate';
type SortDirection = 'asc' | 'desc';

interface FilesWindowTableViewProps {
  showDeleted: boolean;
  onUpload: () => void;
}

interface SortHeaderProps {
  column: SortColumn;
  label: string;
  currentColumn: SortColumn;
  direction: SortDirection;
  onClick: (column: SortColumn) => void;
}

function SortHeader({
  column,
  label,
  currentColumn,
  direction,
  onClick
}: SortHeaderProps) {
  const isActive = column === currentColumn;

  return (
    <button
      type="button"
      className="flex items-center gap-1 text-left font-medium hover:text-foreground"
      onClick={() => onClick(column)}
    >
      {label}
      {isActive && (
        <span className="shrink-0">
          {direction === 'asc' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </span>
      )}
    </button>
  );
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('audio/')) {
    return <Music className="h-3 w-3 shrink-0 text-muted-foreground" />;
  }
  if (mimeType === 'application/pdf') {
    return <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />;
  }
  return <FileIcon className="h-3 w-3 shrink-0 text-muted-foreground" />;
}

function getFileTypeDisplay(mimeType: string): string {
  const typeMap: Record<string, string> = {
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/gif': 'GIF',
    'image/webp': 'WebP',
    'image/svg+xml': 'SVG',
    'audio/mpeg': 'MP3',
    'audio/wav': 'WAV',
    'audio/ogg': 'OGG',
    'audio/flac': 'FLAC',
    'video/mp4': 'MP4',
    'video/webm': 'WebM',
    'video/quicktime': 'MOV',
    'application/pdf': 'PDF',
    'text/plain': 'Text',
    'application/json': 'JSON'
  };

  if (typeMap[mimeType]) {
    return typeMap[mimeType];
  }

  const [type, subtype] = mimeType.split('/');
  if (subtype) {
    return subtype.toUpperCase();
  }
  return type?.toUpperCase() ?? 'Unknown';
}

export function FilesWindowTableView({
  showDeleted,
  onUpload
}: FilesWindowTableViewProps) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const { t } = useTypedTranslation('contextMenu');
  const navigateWithFrom = useNavigateWithFrom();
  const { currentTrack, isPlaying, play, pause, resume } = useAudio();
  const [files, setFiles] = useState<FileWithThumbnail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('uploadDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [contextMenu, setContextMenu] = useState<{
    file: FileWithThumbnail;
    x: number;
    y: number;
  } | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
        audioObjectUrlRef.current = null;
      }
    };
  }, []);

  const filteredFiles = files.filter((f) => showDeleted || !f.deleted);

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

  const fetchedForInstanceRef = useRef<string | null>(null);

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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, file: FileWithThumbnail) => {
      e.preventDefault();
      setContextMenu({ file, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleView = useCallback(
    (file: FileInfo) => {
      const fileType = file.mimeType.split('/')[0] ?? '';
      const routeMapping: Record<string, string> = {
        image: '/photos',
        audio: '/audio',
        video: '/videos'
      };

      if (file.mimeType === 'application/pdf') {
        navigateWithFrom(`/documents/${file.id}`, {
          fromLabel: 'Back to Files'
        });
        return;
      }

      const basePath = routeMapping[fileType];
      if (basePath) {
        navigateWithFrom(`${basePath}/${file.id}`, {
          fromLabel: 'Back to Files'
        });
      }
    },
    [navigateWithFrom]
  );

  const handleDownload = useCallback(
    async (file: FileInfo) => {
      try {
        if (!currentInstanceId) throw new Error('No active instance');
        const data = await retrieveFileData(
          file.storagePath,
          currentInstanceId
        );
        downloadFile(data, file.name);
      } catch (err) {
        console.error('Failed to download file:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [currentInstanceId]
  );

  const handleDelete = useCallback(async (file: FileInfo) => {
    try {
      const db = getDatabase();
      await db
        .update(filesTable)
        .set({ deleted: true })
        .where(eq(filesTable.id, file.id));

      setFiles((prev) =>
        prev.map((f) => (f.id === file.id ? { ...f, deleted: true } : f))
      );
    } catch (err) {
      console.error('Failed to delete file:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleRestore = useCallback(async (file: FileInfo) => {
    try {
      const db = getDatabase();
      await db
        .update(filesTable)
        .set({ deleted: false })
        .where(eq(filesTable.id, file.id));

      setFiles((prev) =>
        prev.map((f) => (f.id === file.id ? { ...f, deleted: false } : f))
      );
    } catch (err) {
      console.error('Failed to restore file:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleGetInfo = useCallback(() => {
    if (contextMenu) {
      handleView(contextMenu.file);
      setContextMenu(null);
    }
  }, [contextMenu, handleView]);

  const handleContextMenuDownload = useCallback(async () => {
    if (contextMenu) {
      await handleDownload(contextMenu.file);
      setContextMenu(null);
    }
  }, [contextMenu, handleDownload]);

  const handleContextMenuDelete = useCallback(async () => {
    if (contextMenu) {
      await handleDelete(contextMenu.file);
      setContextMenu(null);
    }
  }, [contextMenu, handleDelete]);

  const handleContextMenuRestore = useCallback(async () => {
    if (contextMenu) {
      await handleRestore(contextMenu.file);
      setContextMenu(null);
    }
  }, [contextMenu, handleRestore]);

  const handlePlayPause = useCallback(
    async (file: FileWithThumbnail) => {
      if (!currentInstanceId) return;

      if (currentTrack?.id === file.id) {
        if (isPlaying) {
          pause();
        } else {
          resume();
        }
      } else {
        try {
          const data = await retrieveFileData(
            file.storagePath,
            currentInstanceId
          );
          const blob = new Blob([new Uint8Array(data)], {
            type: file.mimeType
          });
          if (audioObjectUrlRef.current) {
            URL.revokeObjectURL(audioObjectUrlRef.current);
          }
          const objectUrl = URL.createObjectURL(blob);
          audioObjectUrlRef.current = objectUrl;
          play({
            id: file.id,
            name: file.name,
            objectUrl,
            mimeType: file.mimeType
          });
        } catch (err) {
          console.error('Failed to load audio:', err);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
      setContextMenu(null);
    },
    [currentInstanceId, currentTrack?.id, isPlaying, pause, resume, play]
  );

  const isViewable = (file: FileInfo) => {
    const fileType = file.mimeType.split('/')[0] ?? '';
    const viewableTypes = ['image', 'audio', 'video'];
    return (
      viewableTypes.includes(fileType) || file.mimeType === 'application/pdf'
    );
  };

  return (
    <div className="flex h-full flex-col space-y-2 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileIcon className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Files</h2>
        </div>
        {isUnlocked && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onUpload}
              className="h-7 px-2"
              data-testid="table-upload-button"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <RefreshButton onClick={fetchFiles} loading={loading} size="sm" />
          </div>
        )}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="files" />}

      {error && (
        <div className="whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked &&
        !error &&
        (loading && !hasFetched ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading files...
          </div>
        ) : filteredFiles.length === 0 && hasFetched ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border p-6 text-center">
            <FileIcon className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">No files yet</p>
              <p className="text-muted-foreground text-xs">
                Upload your first file
              </p>
            </div>
            <Button
              size="sm"
              onClick={onUpload}
              data-testid="table-empty-upload-button"
            >
              <Plus className="mr-1 h-3 w-3" />
              Upload
            </Button>
          </div>
        ) : (
          <div className="flex-1 overflow-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">
                    <SortHeader
                      column="name"
                      label="Name"
                      currentColumn={sortColumn}
                      direction={sortDirection}
                      onClick={handleSortChange}
                    />
                  </th>
                  <th className="px-2 py-1.5 text-left">
                    <SortHeader
                      column="size"
                      label="Size"
                      currentColumn={sortColumn}
                      direction={sortDirection}
                      onClick={handleSortChange}
                    />
                  </th>
                  <th className="px-2 py-1.5 text-left">
                    <SortHeader
                      column="mimeType"
                      label="Type"
                      currentColumn={sortColumn}
                      direction={sortDirection}
                      onClick={handleSortChange}
                    />
                  </th>
                  <th className="px-2 py-1.5 text-left">
                    <SortHeader
                      column="uploadDate"
                      label="Date"
                      currentColumn={sortColumn}
                      direction={sortDirection}
                      onClick={handleSortChange}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredFiles.map((file) => {
                  const clickable = isViewable(file) && !file.deleted;

                  return (
                    <tr
                      key={file.id}
                      className={`cursor-pointer border-border/50 border-b hover:bg-accent/50 ${
                        file.deleted ? 'opacity-60' : ''
                      }`}
                      onClick={clickable ? () => handleView(file) : undefined}
                      onContextMenu={(e) => handleContextMenu(e, file)}
                    >
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          {file.thumbnailUrl ? (
                            <img
                              src={file.thumbnailUrl}
                              alt=""
                              className="h-4 w-4 shrink-0 rounded object-cover"
                            />
                          ) : (
                            getFileIcon(file.mimeType)
                          )}
                          <span
                            className={`truncate ${file.deleted ? 'line-through' : ''}`}
                          >
                            {file.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {formatFileSize(file.size)}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {getFileTypeDisplay(file.mimeType)}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {file.uploadDate.toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {contextMenu &&
        (() => {
          const isPlayingCurrentFile =
            contextMenu.file.id === currentTrack?.id && isPlaying;
          const fileIsViewable = isViewable(contextMenu.file);
          const isAudio = contextMenu.file.mimeType.startsWith('audio/');
          const isVideo = contextMenu.file.mimeType.startsWith('video/');

          return (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onClose={() => setContextMenu(null)}
            >
              {!contextMenu.file.deleted && (
                <>
                  {isAudio && (
                    <ContextMenuItem
                      icon={
                        isPlayingCurrentFile ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )
                      }
                      onClick={() => handlePlayPause(contextMenu.file)}
                    >
                      {isPlayingCurrentFile ? t('pause') : t('play')}
                    </ContextMenuItem>
                  )}
                  {isVideo && (
                    <ContextMenuItem
                      icon={<Play className="h-4 w-4" />}
                      onClick={handleGetInfo}
                    >
                      {t('play')}
                    </ContextMenuItem>
                  )}
                  {fileIsViewable && (
                    <ContextMenuItem
                      icon={<Info className="h-4 w-4" />}
                      onClick={handleGetInfo}
                    >
                      {t('getInfo')}
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem
                    icon={<Download className="h-4 w-4" />}
                    onClick={handleContextMenuDownload}
                  >
                    {t('download')}
                  </ContextMenuItem>
                  <ContextMenuItem
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={handleContextMenuDelete}
                  >
                    {t('delete')}
                  </ContextMenuItem>
                </>
              )}
              {contextMenu.file.deleted && (
                <ContextMenuItem
                  icon={<RotateCcw className="h-4 w-4" />}
                  onClick={handleContextMenuRestore}
                >
                  {t('restore')}
                </ContextMenuItem>
              )}
            </ContextMenu>
          );
        })()}
    </div>
  );
}
