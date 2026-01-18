import { eq } from 'drizzle-orm';
import {
  ChevronDown,
  ChevronUp,
  Download,
  ImageIcon,
  Info,
  Share2,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { files } from '@/db/schema';
import { useTypedTranslation } from '@/i18n';
import { canShareFiles, downloadFile, shareFile } from '@/lib/file-utils';
import { formatFileSize } from '@/lib/utils';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import {
  type PhotoWithUrl,
  usePhotosWindowData
} from './usePhotosWindowData';

type SortColumn = 'name' | 'size' | 'mimeType' | 'uploadDate';
type SortDirection = 'asc' | 'desc';

interface PhotosWindowTableViewProps {
  onSelectPhoto?: (photoId: string) => void;
  refreshToken: number;
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

function getPhotoTypeDisplay(mimeType: string): string {
  const typeMap: Record<string, string> = {
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/gif': 'GIF',
    'image/webp': 'WebP',
    'image/heic': 'HEIC',
    'image/heif': 'HEIF'
  };

  if (typeMap[mimeType]) {
    return typeMap[mimeType];
  }

  const [, subtype] = mimeType.split('/');
  if (subtype) {
    return subtype.toUpperCase();
  }
  return 'Image';
}

export function PhotosWindowTableView({
  onSelectPhoto,
  refreshToken
}: PhotosWindowTableViewProps) {
  const { t } = useTypedTranslation('contextMenu');
  const {
    photos,
    loading,
    error,
    hasFetched,
    isUnlocked,
    isLoading,
    refresh,
    currentInstanceId
  } = usePhotosWindowData({ refreshToken });
  const [contextMenu, setContextMenu] = useState<{
    photo: PhotoWithUrl;
    x: number;
    y: number;
  } | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('uploadDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    setCanShare(canShareFiles());
  }, []);

  const sortedPhotos = useMemo(() => {
    const sorted = [...photos].sort((a, b) => {
      switch (sortColumn) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'size':
          return a.size - b.size;
        case 'mimeType':
          return a.mimeType.localeCompare(b.mimeType);
        case 'uploadDate':
          return a.uploadDate.getTime() - b.uploadDate.getTime();
        default:
          return 0;
      }
    });
    return sortDirection === 'asc' ? sorted : sorted.reverse();
  }, [photos, sortColumn, sortDirection]);

  const handleSortChange = useCallback(
    (column: SortColumn) => {
      if (column === sortColumn) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        return;
      }
      setSortColumn(column);
      setSortDirection('asc');
    },
    [sortColumn]
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, photo: PhotoWithUrl) => {
      event.preventDefault();
      setContextMenu({ photo, x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleGetInfo = useCallback(() => {
    if (!contextMenu) return;
    onSelectPhoto?.(contextMenu.photo.id);
    setContextMenu(null);
  }, [contextMenu, onSelectPhoto]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: true })
        .where(eq(files.id, contextMenu.photo.id));
      await refresh();
    } catch (err) {
      console.error('Failed to delete photo:', err);
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, refresh]);

  const handleDownload = useCallback(
    async (photo: PhotoWithUrl) => {
      try {
        const keyManager = getKeyManager();
        const encryptionKey = keyManager.getCurrentKey();
        if (!encryptionKey) throw new Error('Database not unlocked');
        if (!currentInstanceId) throw new Error('No active instance');

        if (!isFileStorageInitialized(currentInstanceId)) {
          await initializeFileStorage(encryptionKey, currentInstanceId);
        }

        const storage = getFileStorage();
        const data = await storage.retrieve(photo.storagePath);
        downloadFile(data, photo.name);
      } catch (err) {
        console.error('Failed to download photo:', err);
      }
    },
    [currentInstanceId]
  );

  const handleShare = useCallback(
    async (photo: PhotoWithUrl) => {
      try {
        const keyManager = getKeyManager();
        const encryptionKey = keyManager.getCurrentKey();
        if (!encryptionKey) throw new Error('Database not unlocked');
        if (!currentInstanceId) throw new Error('No active instance');

        if (!isFileStorageInitialized(currentInstanceId)) {
          await initializeFileStorage(encryptionKey, currentInstanceId);
        }

        const storage = getFileStorage();
        const data = await storage.retrieve(photo.storagePath);
        await shareFile(data, photo.name, photo.mimeType);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to share photo:', err);
      }
    },
    [currentInstanceId]
  );

  return (
    <div className="flex h-full flex-col space-y-2 p-3">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-4 w-4 text-muted-foreground" />
        <p className="font-medium text-sm">Photos</p>
      </div>

      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="photos" />}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked && !error && (
        <div className="flex min-h-0 flex-1 flex-col">
          {loading && !hasFetched ? (
            <div className="rounded-lg border p-6 text-center text-muted-foreground text-xs">
              Loading photos...
            </div>
          ) : sortedPhotos.length === 0 && hasFetched ? (
            <div className="rounded-lg border p-6 text-center text-muted-foreground text-xs">
              No photos yet. Use Upload to add images.
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
                  {sortedPhotos.map((photo) => (
                    <tr
                      key={photo.id}
                      className="cursor-pointer border-border/50 border-b hover:bg-accent/50"
                      onClick={() => onSelectPhoto?.(photo.id)}
                      onContextMenu={(event) =>
                        handleContextMenu(event, photo)
                      }
                    >
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <img
                            src={photo.objectUrl}
                            alt=""
                            className="h-5 w-5 shrink-0 rounded object-cover"
                          />
                          <span className="truncate">{photo.name}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {formatFileSize(photo.size)}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {getPhotoTypeDisplay(photo.mimeType)}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {photo.uploadDate.toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          <ContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={handleGetInfo}
          >
            {t('getInfo')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Download className="h-4 w-4" />}
            onClick={() => handleDownload(contextMenu.photo)}
          >
            {t('download')}
          </ContextMenuItem>
          {canShare && (
            <ContextMenuItem
              icon={<Share2 className="h-4 w-4" />}
              onClick={() => handleShare(contextMenu.photo)}
            >
              Share
            </ContextMenuItem>
          )}
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={handleDelete}
          >
            {t('delete')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
