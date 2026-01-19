import { useVirtualizer } from '@tanstack/react-virtual';
import { desc, eq } from 'drizzle-orm';
import {
  Check,
  Download,
  FileIcon,
  FileText,
  Info,
  Loader2,
  Music,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  XCircle
} from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react';
import { useAudio } from '@/audio';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { Dropzone } from '@/components/ui/dropzone';
import { ListRow } from '@/components/ui/list-row';
import { RefreshButton } from '@/components/ui/refresh-button';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files as filesTable } from '@/db/schema';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useOnInstanceChange } from '@/hooks/useInstanceChange';
import { useVirtualVisibleRange } from '@/hooks/useVirtualVisibleRange';
import { useTypedTranslation } from '@/i18n';
import { retrieveFileData } from '@/lib/data-retrieval';
import { getErrorMessage } from '@/lib/errors';
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

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'complete' | 'duplicate' | 'error';
  error?: string;
}

const ROW_HEIGHT_ESTIMATE = 56;

export interface FilesListRef {
  triggerUpload: (files: File[]) => void;
}

export interface FilesListProps {
  showDeleted: boolean;
  onShowDeletedChange?: (show: boolean) => void;
  showHeader?: boolean;
  onFilesChange?: () => void;
  onSelectFile?: (fileId: string) => void;
  refreshToken?: number;
}

export const FilesList = forwardRef<FilesListRef, FilesListProps>(
  function FilesList(
    {
      showDeleted,
      onShowDeletedChange,
      showHeader = true,
      onFilesChange,
      onSelectFile,
      refreshToken
    },
    ref
  ) {
    const navigateWithFrom = useNavigateWithFrom();
    const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
    const [files, setFiles] = useState<FileWithThumbnail[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasFetched, setHasFetched] = useState(false);
    const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
    const [recentlyUploadedIds, setRecentlyUploadedIds] = useState<Set<string>>(
      new Set()
    );
    const { uploadFile } = useFileUpload();
    const parentRef = useRef<HTMLDivElement>(null);
    const { currentTrack, isPlaying, play, pause, resume } = useAudio();
    const { t } = useTypedTranslation('contextMenu');
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

    // Clear files immediately when instance changes via direct subscription
    // This is more reliable than waiting for currentInstanceId to update in React state
    useOnInstanceChange(
      useCallback(() => {
        // Revoke all thumbnail URLs to prevent memory leaks
        setFiles((prevFiles) => {
          for (const file of prevFiles) {
            if (file.thumbnailUrl) {
              URL.revokeObjectURL(file.thumbnailUrl);
            }
          }
          return [];
        });
        setError(null);
        setHasFetched(false);
      }, [])
    );

    const filteredFiles = files.filter((f) => showDeleted || !f.deleted);

    const virtualizer = useVirtualizer({
      count: filteredFiles.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => ROW_HEIGHT_ESTIMATE,
      overscan: 5
    });

    const virtualItems = virtualizer.getVirtualItems();
    const { firstVisible, lastVisible } = useVirtualVisibleRange(virtualItems);

    const fetchFiles = useCallback(async () => {
      if (!isUnlocked) return;

      // Capture instance ID at fetch start to detect stale responses
      const fetchInstanceId = currentInstanceId;

      setLoading(true);
      setError(null);

      try {
        const db = getDatabase();

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
          .orderBy(desc(filesTable.uploadDate));

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

        // Guard: if instance changed during fetch, discard stale results
        if (fetchInstanceId !== currentInstanceId) {
          // Revoke URLs we just created since they won't be used
          for (const file of filesWithThumbnails) {
            if (file.thumbnailUrl) {
              URL.revokeObjectURL(file.thumbnailUrl);
            }
          }
          return;
        }

        setFiles(filesWithThumbnails);
        setHasFetched(true);
      } catch (err) {
        // Guard: don't set error state if instance changed
        if (fetchInstanceId !== currentInstanceId) return;
        console.error('Failed to fetch files:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        // Guard: don't clear loading if instance changed (new fetch may be starting)
        if (fetchInstanceId === currentInstanceId) {
          setLoading(false);
        }
      }
    }, [isUnlocked, currentInstanceId]);

    const fetchedForInstanceRef = useRef<string | null>(null);

    // Clear files when instance changes (even if locked)
    // This ensures we don't show stale data from the previous instance
    useEffect(() => {
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
        fetchedForInstanceRef.current !== null
      ) {
        // Revoke thumbnail URLs to prevent memory leaks
        for (const file of files) {
          if (file.thumbnailUrl) {
            URL.revokeObjectURL(file.thumbnailUrl);
          }
        }
        setFiles([]);
        setError(null);
        setHasFetched(false);
      }
      fetchedForInstanceRef.current = currentInstanceId;
    }, [currentInstanceId, files]);

    // Fetch files when unlocked and instance is ready
    // biome-ignore lint/correctness/useExhaustiveDependencies: hasFetched intentionally excluded
    useEffect(() => {
      const needsFetch = isUnlocked && !loading && !hasFetched;

      if (needsFetch) {
        const timeoutId = setTimeout(() => {
          fetchFiles();
        }, 0);

        return () => clearTimeout(timeoutId);
      }
      return undefined;
    }, [isUnlocked, loading, fetchFiles]);

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

    const handleFilesSelected = useCallback(
      async (selectedFiles: File[]) => {
        if (!isUnlocked) return;

        const newFiles: UploadingFile[] = selectedFiles.map((file) => ({
          id: crypto.randomUUID(),
          file,
          progress: 0,
          status: 'pending'
        }));
        setUploadingFiles((prev) => [...prev, ...newFiles]);

        const uploadedIds: string[] = [];
        const uploadPromises = newFiles.map(async (fileEntry) => {
          try {
            setUploadingFiles((prev) =>
              prev.map((f) =>
                f.id === fileEntry.id ? { ...f, status: 'uploading' } : f
              )
            );

            const result = await uploadFile(fileEntry.file, (progress) => {
              setUploadingFiles((prev) =>
                prev.map((f) =>
                  f.id === fileEntry.id ? { ...f, progress } : f
                )
              );
            });

            if (!result.isDuplicate) {
              uploadedIds.push(result.id);
            }

            setUploadingFiles((prev) =>
              prev.map((f) =>
                f.id === fileEntry.id
                  ? {
                      ...f,
                      status: result.isDuplicate ? 'duplicate' : 'complete',
                      progress: 100
                    }
                  : f
              )
            );
          } catch (err) {
            setUploadingFiles((prev) =>
              prev.map((f) =>
                f.id === fileEntry.id
                  ? { ...f, status: 'error', error: getErrorMessage(err) }
                  : f
              )
            );
          }
        });

        await Promise.all(uploadPromises);

        if (uploadedIds.length > 0) {
          setRecentlyUploadedIds((prev) => new Set([...prev, ...uploadedIds]));
        }

        setUploadingFiles((prev) =>
          prev.filter(
            (f) => f.status !== 'complete' && f.status !== 'duplicate'
          )
        );

        fetchFiles();
        onFilesChange?.();
      },
      [isUnlocked, uploadFile, fetchFiles, onFilesChange]
    );

    useImperativeHandle(
      ref,
      () => ({
        triggerUpload: handleFilesSelected
      }),
      [handleFilesSelected]
    );

    const clearRecentlyUploaded = useCallback((fileId: string) => {
      setRecentlyUploadedIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    }, []);

    const handleView = useCallback(
      (file: FileInfo) => {
        if (onSelectFile) {
          onSelectFile(file.id);
          return;
        }

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
      [navigateWithFrom, onSelectFile]
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

    const handleContextMenu = useCallback(
      (e: React.MouseEvent, file: FileWithThumbnail) => {
        e.preventDefault();
        setContextMenu({ file, x: e.clientX, y: e.clientY });
      },
      []
    );

    const handleCloseContextMenu = useCallback(() => {
      setContextMenu(null);
    }, []);

    const handleContextMenuGetInfo = useCallback(
      (file: FileWithThumbnail) => {
        handleView(file);
        setContextMenu(null);
      },
      [handleView]
    );

    const handleContextMenuDownload = useCallback(
      async (file: FileWithThumbnail) => {
        await handleDownload(file);
        setContextMenu(null);
      },
      [handleDownload]
    );

    const handleContextMenuDelete = useCallback(
      async (file: FileWithThumbnail) => {
        await handleDelete(file);
        setContextMenu(null);
      },
      [handleDelete]
    );

    const handleContextMenuPlayPause = useCallback(
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

    return (
      <div className="flex h-full flex-col space-y-6">
        {showHeader && (
          <div className="space-y-2">
            <BackLink defaultTo="/" defaultLabel="Back to Home" />
            <div className="flex items-center justify-between">
              <h1 className="font-bold text-2xl tracking-tight">Files</h1>
              {isUnlocked && (
                <div className="flex items-center gap-3">
                  {onShowDeletedChange && (
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={showDeleted}
                        onClick={() => onShowDeletedChange(!showDeleted)}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                          showDeleted ? 'bg-primary' : 'bg-muted'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-background shadow-sm transition-transform ${
                            showDeleted ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                      <span className="text-muted-foreground">
                        Show deleted
                      </span>
                    </label>
                  )}
                  <RefreshButton onClick={fetchFiles} loading={loading} />
                </div>
              )}
            </div>
          </div>
        )}

        {isUnlocked && (
          <Dropzone onFilesSelected={handleFilesSelected} disabled={false} />
        )}

        {uploadingFiles.length > 0 && (
          <div className="space-y-2">
            {uploadingFiles.map((entry) => (
              <ListRow key={entry.id}>
                {entry.status === 'uploading' && (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
                )}
                {entry.status === 'error' && (
                  <XCircle className="h-5 w-5 shrink-0 text-destructive" />
                )}
                {entry.status === 'pending' && (
                  <FileIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">
                    {entry.file.name}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {formatFileSize(entry.file.size)}
                    {entry.status === 'uploading' && ` · ${entry.progress}%`}
                    {entry.status === 'error' && ` · ${entry.error}`}
                  </p>
                </div>
              </ListRow>
            ))}
          </div>
        )}

        {isLoading && (
          <div className="rounded-lg border p-8 text-center text-muted-foreground">
            Loading database...
          </div>
        )}

        {!isLoading && !isUnlocked && <InlineUnlock description="files" />}

        {error && (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
            {error}
          </div>
        )}

        {isUnlocked && !error && (
          <div className="flex min-h-0 flex-1 flex-col">
            {loading || !hasFetched ? (
              <div className="rounded-lg border p-8 text-center text-muted-foreground">
                Loading files...
              </div>
            ) : filteredFiles.length === 0 ? (
              <div className="rounded-lg border p-8 text-center text-muted-foreground">
                No files found. Drop or select files above to upload.
              </div>
            ) : (
              <>
                <VirtualListStatus
                  firstVisible={firstVisible}
                  lastVisible={lastVisible}
                  loadedCount={filteredFiles.length}
                  itemLabel="file"
                  className="mb-2"
                />
                <div className="flex-1 rounded-lg border">
                  <div ref={parentRef} className="h-full overflow-auto">
                    <div
                      className="relative w-full"
                      style={{ height: `${virtualizer.getTotalSize()}px` }}
                    >
                      {virtualItems.map((virtualItem) => {
                        const file = filteredFiles[virtualItem.index];
                        if (!file) return null;

                        const isRecentlyUploaded = recentlyUploadedIds.has(
                          file.id
                        );
                        const fileType = file.mimeType.split('/')[0] ?? '';
                        const viewableTypes = ['image', 'audio', 'video'];
                        const isPdf = file.mimeType === 'application/pdf';
                        const isClickable =
                          (viewableTypes.includes(fileType) || isPdf) &&
                          !file.deleted;

                        const content = (
                          <>
                            <div className="relative shrink-0">
                              {file.thumbnailUrl ? (
                                <img
                                  src={file.thumbnailUrl}
                                  alt=""
                                  className="h-8 w-8 rounded object-cover"
                                />
                              ) : file.mimeType.startsWith('audio/') ? (
                                <Music className="h-5 w-5 text-muted-foreground" />
                              ) : isPdf ? (
                                <FileText className="h-5 w-5 text-muted-foreground" />
                              ) : (
                                <FileIcon className="h-5 w-5 text-muted-foreground" />
                              )}
                              {isRecentlyUploaded && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    if (isClickable) e.stopPropagation();
                                    clearRecentlyUploaded(file.id);
                                  }}
                                  className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-success text-success-foreground"
                                  title="Upload successful - click to dismiss"
                                  data-testid="upload-success-badge"
                                >
                                  <Check className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p
                                className={`truncate font-medium text-sm ${
                                  file.deleted ? 'line-through' : ''
                                }`}
                              >
                                {file.name}
                              </p>
                              <p className="text-muted-foreground text-xs">
                                {formatFileSize(file.size)} ·{' '}
                                {file.uploadDate.toLocaleDateString()}
                                {file.deleted && ' · Deleted'}
                              </p>
                            </div>
                          </>
                        );

                        return (
                          <div
                            key={file.id}
                            data-index={virtualItem.index}
                            ref={virtualizer.measureElement}
                            className="absolute top-0 left-0 w-full px-1 py-0.5"
                            style={{
                              transform: `translateY(${virtualItem.start}px)`
                            }}
                          >
                            <ListRow
                              className={`${file.deleted ? 'opacity-60' : ''}`}
                              onContextMenu={
                                file.deleted
                                  ? undefined
                                  : (e) => handleContextMenu(e, file)
                              }
                            >
                              {isClickable ? (
                                <button
                                  type="button"
                                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
                                  onClick={() => handleView(file)}
                                >
                                  {content}
                                </button>
                              ) : (
                                <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                                  {content}
                                </div>
                              )}
                              <div className="flex shrink-0 gap-1">
                                {file.deleted ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleRestore(file)}
                                    title="Restore"
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                  </Button>
                                ) : (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => handleDownload(file)}
                                      title="Download"
                                    >
                                      <Download className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => handleDelete(file)}
                                      title="Delete"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </ListRow>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <Dropzone
                  onFilesSelected={handleFilesSelected}
                  disabled={false}
                  compact
                  variant="row"
                  className="mt-2"
                />
              </>
            )}
          </div>
        )}

        {contextMenu &&
          (() => {
            const isPlayingCurrentFile =
              contextMenu.file.id === currentTrack?.id && isPlaying;
            const isViewable =
              contextMenu.file.mimeType.startsWith('audio/') ||
              contextMenu.file.mimeType.startsWith('image/') ||
              contextMenu.file.mimeType.startsWith('video/') ||
              contextMenu.file.mimeType === 'application/pdf';

            return (
              <ContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                onClose={handleCloseContextMenu}
              >
                {contextMenu.file.mimeType.startsWith('audio/') && (
                  <ContextMenuItem
                    icon={
                      isPlayingCurrentFile ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )
                    }
                    onClick={() => handleContextMenuPlayPause(contextMenu.file)}
                  >
                    {isPlayingCurrentFile ? t('pause') : t('play')}
                  </ContextMenuItem>
                )}
                {contextMenu.file.mimeType.startsWith('video/') && (
                  <ContextMenuItem
                    icon={<Play className="h-4 w-4" />}
                    onClick={() => handleContextMenuGetInfo(contextMenu.file)}
                  >
                    {t('play')}
                  </ContextMenuItem>
                )}
                {isViewable && (
                  <ContextMenuItem
                    icon={<Info className="h-4 w-4" />}
                    onClick={() => handleContextMenuGetInfo(contextMenu.file)}
                  >
                    {t('getInfo')}
                  </ContextMenuItem>
                )}
                <ContextMenuItem
                  icon={<Download className="h-4 w-4" />}
                  onClick={() => handleContextMenuDownload(contextMenu.file)}
                >
                  {t('download')}
                </ContextMenuItem>
                <ContextMenuItem
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => handleContextMenuDelete(contextMenu.file)}
                >
                  {t('delete')}
                </ContextMenuItem>
              </ContextMenu>
            );
          })()}
      </div>
    );
  }
);
