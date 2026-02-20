import { useVirtualizer } from '@tanstack/react-virtual';
import { FileIcon, Loader2, XCircle } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { Dropzone } from '@/components/ui/dropzone';
import { ListRow } from '@/components/ui/ListRow';
import { RefreshButton } from '@/components/ui/RefreshButton';
import {
  getVirtualListStatusText,
  VirtualListStatus
} from '@/components/ui/VirtualListStatus';
import { useDatabaseContext } from '@/db/hooks';
import { useVirtualVisibleRange } from '@/hooks/device';
import { formatFileSize } from '@/lib/utils';
import {
  BlankSpaceContextMenu,
  FilesListContextMenu
} from './FilesListContextMenu';
import { FilesListRow } from './FilesListRow';
import type { FileWithThumbnail } from './types';
import { useFilesActions } from './useFilesActions';
import { useFilesData } from './useFilesData';
import { useFilesUpload } from './useFilesUpload';

const ROW_HEIGHT_ESTIMATE = 56;

export interface FilesListRef {
  triggerUpload: (files: File[]) => void;
}

export interface FilesListProps {
  showDeleted: boolean;
  onShowDeletedChange?: (show: boolean) => void;
  showHeader?: boolean;
  showDropzone?: boolean;
  showInlineStatus?: boolean;
  onFilesChange?: () => void;
  onSelectFile?: (fileId: string) => void;
  onStatusTextChange?: (text: string) => void;
  refreshToken?: number;
  onUpload?: () => void;
  onUploadInProgressChange?: (inProgress: boolean) => void;
}

export const FilesList = forwardRef<FilesListRef, FilesListProps>(
  function FilesList(
    {
      showDeleted,
      onShowDeletedChange,
      showHeader = true,
      showDropzone = true,
      showInlineStatus = true,
      onFilesChange,
      onSelectFile,
      onStatusTextChange,
      refreshToken,
      onUpload,
      onUploadInProgressChange
    },
    ref
  ) {
    const { isUnlocked, isLoading } = useDatabaseContext();
    const parentRef = useRef<HTMLDivElement>(null);
    const [contextMenu, setContextMenu] = useState<{
      file: FileWithThumbnail;
      x: number;
      y: number;
    } | null>(null);
    const [blankSpaceMenu, setBlankSpaceMenu] = useState<{
      x: number;
      y: number;
    } | null>(null);

    // Use custom hooks for data, upload, and actions
    const {
      files,
      loading,
      error,
      hasFetched,
      fetchFiles,
      setFiles,
      setError
    } = useFilesData({ refreshToken });

    const {
      uploadingFiles,
      recentlyUploadedIds,
      isUploadInProgress,
      handleFilesSelected,
      clearRecentlyUploaded
    } = useFilesUpload({
      isUnlocked,
      onFilesChange,
      onUpload,
      fetchFiles
    });

    const {
      handleView,
      handleDownload,
      handleDelete,
      handleRestore,
      handlePlayPause,
      currentTrackId,
      isPlaying
    } = useFilesActions({
      onSelectFile,
      setFiles,
      setError
    });

    useEffect(() => {
      onUploadInProgressChange?.(isUploadInProgress);
    }, [isUploadInProgress, onUploadInProgressChange]);

    useEffect(
      () => () => {
        onUploadInProgressChange?.(false);
      },
      [onUploadInProgressChange]
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

    useEffect(() => {
      if (!onStatusTextChange) return;

      if (isLoading) {
        onStatusTextChange('Loading database...');
        return;
      }

      if (!isUnlocked) {
        onStatusTextChange('Database locked');
        return;
      }

      if (error) {
        onStatusTextChange(error);
        return;
      }

      if (loading || !hasFetched) {
        onStatusTextChange('Loading files...');
        return;
      }

      onStatusTextChange(
        getVirtualListStatusText({
          firstVisible,
          lastVisible,
          loadedCount: filteredFiles.length,
          itemLabel: 'file'
        })
      );
    }, [
      error,
      filteredFiles.length,
      firstVisible,
      hasFetched,
      isLoading,
      isUnlocked,
      lastVisible,
      loading,
      onStatusTextChange
    ]);

    useImperativeHandle(
      ref,
      () => ({
        triggerUpload: handleFilesSelected
      }),
      [handleFilesSelected]
    );

    const handleContextMenu = useCallback(
      (e: React.MouseEvent, file: FileWithThumbnail) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ file, x: e.clientX, y: e.clientY });
      },
      []
    );

    const handleBlankSpaceContextMenu = useCallback(
      (e: React.MouseEvent) => {
        if (!onUpload) return;
        e.preventDefault();
        setBlankSpaceMenu({ x: e.clientX, y: e.clientY });
      },
      [onUpload]
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

    const handleContextMenuRestore = useCallback(
      async (file: FileWithThumbnail) => {
        await handleRestore(file);
        setContextMenu(null);
      },
      [handleRestore]
    );

    const handleContextMenuPlayPause = useCallback(
      async (file: FileWithThumbnail) => {
        await handlePlayPause(file);
        setContextMenu(null);
      },
      [handlePlayPause]
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

        {isUnlocked && showDropzone && (
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
              // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty state
              <div
                className="rounded-lg border p-8 text-center text-muted-foreground"
                onContextMenu={handleBlankSpaceContextMenu}
              >
                No files found. Drop or select files above to upload.
              </div>
            ) : (
              <>
                {showInlineStatus && (
                  <VirtualListStatus
                    firstVisible={firstVisible}
                    lastVisible={lastVisible}
                    loadedCount={filteredFiles.length}
                    itemLabel="file"
                    className="mb-2"
                  />
                )}
                <div className="flex-1 rounded-lg border">
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty space */}
                  <div
                    ref={parentRef}
                    className="h-full overflow-auto"
                    onContextMenu={handleBlankSpaceContextMenu}
                  >
                    <div
                      className="relative w-full"
                      style={{ height: `${virtualizer.getTotalSize()}px` }}
                    >
                      {virtualItems.map((virtualItem) => {
                        const file = filteredFiles[virtualItem.index];
                        if (!file) return null;

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
                            <FilesListRow
                              file={file}
                              isRecentlyUploaded={recentlyUploadedIds.has(
                                file.id
                              )}
                              onView={() => handleView(file)}
                              onDownload={() => handleDownload(file)}
                              onDelete={() => handleDelete(file)}
                              onRestore={() => handleRestore(file)}
                              onContextMenu={(e) => handleContextMenu(e, file)}
                              onClearRecentlyUploaded={() =>
                                clearRecentlyUploaded(file.id)
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {showDropzone && (
                  <Dropzone
                    onFilesSelected={handleFilesSelected}
                    disabled={false}
                    compact
                    variant="row"
                    className="mt-2"
                  />
                )}
              </>
            )}
          </div>
        )}

        {contextMenu && (
          <FilesListContextMenu
            file={contextMenu.file}
            x={contextMenu.x}
            y={contextMenu.y}
            isPlayingCurrentFile={
              contextMenu.file.id === currentTrackId && isPlaying
            }
            onClose={handleCloseContextMenu}
            onGetInfo={() => handleContextMenuGetInfo(contextMenu.file)}
            onDownload={() => handleContextMenuDownload(contextMenu.file)}
            onDelete={() => handleContextMenuDelete(contextMenu.file)}
            onRestore={() => handleContextMenuRestore(contextMenu.file)}
            onPlayPause={() => handleContextMenuPlayPause(contextMenu.file)}
          />
        )}

        {blankSpaceMenu && onUpload && (
          <BlankSpaceContextMenu
            x={blankSpaceMenu.x}
            y={blankSpaceMenu.y}
            onClose={() => setBlankSpaceMenu(null)}
            onUpload={onUpload}
          />
        )}
      </div>
    );
  }
);
