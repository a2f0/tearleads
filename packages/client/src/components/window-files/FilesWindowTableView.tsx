import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem,
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import {
  Download,
  FileIcon,
  Info,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { useDatabaseContext } from '@/db/hooks';
import { useTypedTranslation } from '@/i18n';
import { formatFileSize } from '@/lib/utils';
import {
  type FilesWindowTableViewProps,
  getFileIcon,
  getFileTypeDisplay,
  isViewable,
  SortHeader,
  useFilesTableActions,
  useFilesTableData
} from './files-table';

export function FilesWindowTableView({
  showDeleted,
  onUpload,
  onSelectFile,
  refreshToken
}: FilesWindowTableViewProps) {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const { t } = useTypedTranslation('contextMenu');

  const {
    files,
    setFiles,
    loading,
    error,
    setError,
    hasFetched,
    sortColumn,
    sortDirection,
    fetchFiles,
    handleSortChange
  } = useFilesTableData(showDeleted, refreshToken);

  const {
    contextMenu,
    setContextMenu,
    blankSpaceMenu,
    setBlankSpaceMenu,
    handleContextMenu,
    handleBlankSpaceContextMenu,
    handleView,
    handleGetInfo,
    handleContextMenuDownload,
    handleContextMenuDelete,
    handleContextMenuRestore,
    handlePlayPause,
    isPlayingCurrentFile
  } = useFilesTableActions(setFiles, setError, onSelectFile);

  const filteredFiles = files.filter((f) => showDeleted || !f.deleted);

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
          // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty state
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg border p-6 text-center"
            onContextMenu={handleBlankSpaceContextMenu}
          >
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
          // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty space
          <div
            className="flex-1 overflow-auto rounded-lg border"
            data-testid="files-table-container"
            onContextMenu={handleBlankSpaceContextMenu}
          >
            <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
              <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
                <tr>
                  <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                    <SortHeader
                      column="name"
                      label="Name"
                      currentColumn={sortColumn}
                      direction={sortDirection}
                      onClick={handleSortChange}
                    />
                  </th>
                  <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                    <SortHeader
                      column="size"
                      label="Size"
                      currentColumn={sortColumn}
                      direction={sortDirection}
                      onClick={handleSortChange}
                    />
                  </th>
                  <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                    <SortHeader
                      column="mimeType"
                      label="Type"
                      currentColumn={sortColumn}
                      direction={sortDirection}
                      onClick={handleSortChange}
                    />
                  </th>
                  <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
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
                  const clickable = isViewable(file.mimeType) && !file.deleted;

                  return (
                    <WindowTableRow
                      key={file.id}
                      isDimmed={file.deleted}
                      onClick={clickable ? () => handleView(file) : undefined}
                      onContextMenu={(e) => handleContextMenu(e, file)}
                    >
                      <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
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
                      <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                        {formatFileSize(file.size)}
                      </td>
                      <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                        {getFileTypeDisplay(file.mimeType)}
                      </td>
                      <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                        {file.uploadDate.toLocaleDateString()}
                      </td>
                    </WindowTableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {contextMenu &&
        (() => {
          const fileIsViewable = isViewable(contextMenu.file.mimeType);
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

      {blankSpaceMenu && (
        <ContextMenu
          x={blankSpaceMenu.x}
          y={blankSpaceMenu.y}
          onClose={() => setBlankSpaceMenu(null)}
        >
          <ContextMenuItem
            icon={<Plus className="h-4 w-4" />}
            onClick={() => {
              onUpload();
              setBlankSpaceMenu(null);
            }}
          >
            Upload
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
