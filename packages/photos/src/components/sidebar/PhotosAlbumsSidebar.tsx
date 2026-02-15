import {
  detectPlatform,
  useResizableSidebar,
  useSidebarDragOver,
  useSidebarRefetch,
  WindowContextMenu,
  WindowSidebarError,
  WindowSidebarHeader,
  WindowSidebarItem,
  WindowSidebarLoading
} from '@tearleads/window-manager';
import { ImagePlus, Images, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { type PhotoAlbum, usePhotosUIContext } from '../../context';
import { canDeleteAlbum, canRenameAlbum } from '../../types';
import { DeleteAlbumDialog } from '../dialogs/DeleteAlbumDialog';
import { NewAlbumDialog } from '../dialogs/NewAlbumDialog';
import { RenameAlbumDialog } from '../dialogs/RenameAlbumDialog';

/** Special ID for showing all photos */
export const ALL_PHOTOS_ID = '__all__';

interface AlbumContextMenuState {
  x: number;
  y: number;
  album: PhotoAlbum;
}

interface EmptySpaceContextMenuState {
  x: number;
  y: number;
}

export interface PhotosAlbumsSidebarProps {
  width: number;
  onWidthChange: (width: number) => void;
  selectedAlbumId: string | null;
  onAlbumSelect: (albumId: string | null) => void;
  refreshToken?: number | undefined;
  onAlbumChanged?: (() => void) | undefined;
  /** Callback when files are dropped onto an album */
  onDropToAlbum?:
    | ((
        albumId: string,
        files: File[],
        photoIds?: string[]
      ) => void | Promise<void>)
    | undefined;
  /** Filter files to accept only certain types */
  filterFilesByAccept?: ((files: File[], accept: string) => File[]) | undefined;
  /** Get drag data for photos being dragged */
  getMediaDragIds?:
    | ((dataTransfer: DataTransfer, mediaType: 'image' | 'video') => string[])
    | undefined;
}

export function PhotosAlbumsSidebar({
  width,
  onWidthChange,
  selectedAlbumId,
  onAlbumSelect,
  refreshToken,
  onAlbumChanged,
  onDropToAlbum,
  filterFilesByAccept,
  getMediaDragIds
}: PhotosAlbumsSidebarProps) {
  const { fetchAlbums, renameAlbum, deleteAlbum, logError } =
    usePhotosUIContext();

  const [albums, setAlbums] = useState<PhotoAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track which album is being dragged over for visual feedback
  const { dragOverId, handleDragEnter, handleDragLeave, clearDragState } =
    useSidebarDragOver();
  const platform = detectPlatform();
  const isNativePlatform = platform === 'ios' || platform === 'android';

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetchedAlbums = await fetchAlbums();
      setAlbums(fetchedAlbums);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      logError('Failed to fetch albums', message);
    } finally {
      setLoading(false);
    }
  }, [fetchAlbums, logError]);

  // Initial fetch
  useEffect(() => {
    void refetch();
  }, [refetch]);

  const handleAlbumDragOver = useCallback(
    (e: React.DragEvent, _albumId: string) => {
      if (!onDropToAlbum || isNativePlatform) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [onDropToAlbum, isNativePlatform]
  );

  const handleAlbumDragEnter = useCallback(
    (e: React.DragEvent, albumId: string) => {
      if (!onDropToAlbum || isNativePlatform) return;
      e.preventDefault();
      e.stopPropagation();

      handleDragEnter(albumId);
    },
    [onDropToAlbum, isNativePlatform, handleDragEnter]
  );

  const handleAlbumDragLeave = useCallback(
    (e: React.DragEvent, albumId: string) => {
      if (!onDropToAlbum || isNativePlatform) return;
      e.preventDefault();
      e.stopPropagation();

      handleDragLeave(albumId);
    },
    [onDropToAlbum, isNativePlatform, handleDragLeave]
  );

  const handleAlbumDrop = useCallback(
    (e: React.DragEvent, albumId: string) => {
      if (!onDropToAlbum || isNativePlatform) return;
      e.preventDefault();
      e.stopPropagation();

      // Reset drag state
      clearDragState(albumId);

      const photoIds = getMediaDragIds?.(e.dataTransfer, 'image') ?? [];
      if (photoIds.length > 0) {
        void onDropToAlbum(albumId, [], photoIds);
        return;
      }

      // Get files and filter for images
      const files = Array.from(e.dataTransfer.files);
      const imageFiles = filterFilesByAccept
        ? filterFilesByAccept(files, 'image/*')
        : files.filter((f) => f.type.startsWith('image/'));

      if (imageFiles.length > 0) {
        void onDropToAlbum(albumId, imageFiles);
      }
    },
    [
      onDropToAlbum,
      isNativePlatform,
      clearDragState,
      getMediaDragIds,
      filterFilesByAccept
    ]
  );

  // Dialog states
  const [newAlbumDialogOpen, setNewAlbumDialogOpen] = useState(false);
  const [renameDialogAlbum, setRenameDialogAlbum] = useState<PhotoAlbum | null>(
    null
  );
  const [deleteDialogAlbum, setDeleteDialogAlbum] = useState<PhotoAlbum | null>(
    null
  );

  // Context menu state
  const [contextMenu, setContextMenu] = useState<AlbumContextMenuState | null>(
    null
  );
  const [emptySpaceContextMenu, setEmptySpaceContextMenu] =
    useState<EmptySpaceContextMenuState | null>(null);

  useSidebarRefetch(refreshToken, refetch);

  const { resizeHandleProps } = useResizableSidebar({
    width,
    onWidthChange,
    ariaLabel: 'Resize albums sidebar'
  });

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, album: PhotoAlbum) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, album });
    },
    []
  );

  const handleEmptySpaceContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setEmptySpaceContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleAlbumChanged = useCallback(() => {
    void refetch();
    onAlbumChanged?.();
  }, [refetch, onAlbumChanged]);

  const handleAlbumDeleted = useCallback(
    (deletedId: string) => {
      if (selectedAlbumId === deletedId) {
        onAlbumSelect(ALL_PHOTOS_ID);
      }
      handleAlbumChanged();
    },
    [selectedAlbumId, onAlbumSelect, handleAlbumChanged]
  );

  const handleRenameAlbum = useCallback(
    async (albumId: string, newName: string) => {
      await renameAlbum(albumId, newName);
    },
    [renameAlbum]
  );

  const handleDeleteAlbum = useCallback(
    async (albumId: string) => {
      await deleteAlbum(albumId);
    },
    [deleteAlbum]
  );

  return (
    <div
      className="relative flex shrink-0 flex-col border-r bg-muted/20"
      style={{ width }}
    >
      <WindowSidebarHeader
        title="Albums"
        actionLabel="New Album"
        onAction={() => setNewAlbumDialogOpen(true)}
        actionIcon={<ImagePlus className="h-4 w-4" />}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Context menu on empty space */}
      <div
        className="flex-1 overflow-y-auto p-1"
        onContextMenu={handleEmptySpaceContextMenu}
      >
        {/* All Photos - always shown */}
        <WindowSidebarItem
          label="All Photos"
          icon={<Images className="h-4 w-4 shrink-0 text-success" />}
          selected={
            selectedAlbumId === ALL_PHOTOS_ID || selectedAlbumId === null
          }
          onClick={() => onAlbumSelect(ALL_PHOTOS_ID)}
          leadingSpacer
        />

        {loading && <WindowSidebarLoading />}
        {error && <WindowSidebarError message={error} />}
        {!loading &&
          !error &&
          albums.map((album) => (
            <WindowSidebarItem
              key={album.id}
              label={album.name}
              icon={<Images className="h-4 w-4 shrink-0 text-success" />}
              selected={selectedAlbumId === album.id}
              className={
                dragOverId === album.id
                  ? 'bg-primary/10 ring-2 ring-primary ring-inset'
                  : undefined
              }
              onClick={() => onAlbumSelect(album.id)}
              onContextMenu={(e) => handleContextMenu(e, album)}
              onDragOver={(e) => handleAlbumDragOver(e, album.id)}
              onDragEnter={(e) => handleAlbumDragEnter(e, album.id)}
              onDragLeave={(e) => handleAlbumDragLeave(e, album.id)}
              onDrop={(e) => handleAlbumDrop(e, album.id)}
              count={album.photoCount}
              leadingSpacer
            />
          ))}
      </div>
      {/* Resize handle */}
      <div
        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-accent"
        {...resizeHandleProps}
      />

      {/* Context Menu */}
      {contextMenu && (
        <AlbumContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          album={contextMenu.album}
          onClose={() => setContextMenu(null)}
          onRename={(album) => setRenameDialogAlbum(album)}
          onDelete={(album) => setDeleteDialogAlbum(album)}
        />
      )}

      {/* Empty Space Context Menu */}
      {emptySpaceContextMenu && (
        <EmptySpaceContextMenu
          x={emptySpaceContextMenu.x}
          y={emptySpaceContextMenu.y}
          onClose={() => setEmptySpaceContextMenu(null)}
          onNewAlbum={() => {
            setNewAlbumDialogOpen(true);
            setEmptySpaceContextMenu(null);
          }}
        />
      )}

      {/* New Album Dialog */}
      <NewAlbumDialog
        open={newAlbumDialogOpen}
        onOpenChange={setNewAlbumDialogOpen}
        onAlbumCreated={handleAlbumChanged}
      />

      {/* Rename Dialog */}
      <RenameAlbumDialog
        open={renameDialogAlbum !== null}
        onOpenChange={(open) => {
          if (!open) setRenameDialogAlbum(null);
        }}
        album={renameDialogAlbum}
        onRename={handleRenameAlbum}
        onAlbumRenamed={handleAlbumChanged}
      />

      {/* Delete Dialog */}
      <DeleteAlbumDialog
        open={deleteDialogAlbum !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogAlbum(null);
        }}
        album={deleteDialogAlbum}
        onDelete={handleDeleteAlbum}
        onAlbumDeleted={handleAlbumDeleted}
      />
    </div>
  );
}

// Context menu component
interface AlbumContextMenuProps {
  x: number;
  y: number;
  album: PhotoAlbum;
  onClose: () => void;
  onRename: (album: PhotoAlbum) => void;
  onDelete: (album: PhotoAlbum) => void;
}

function AlbumContextMenu({
  x,
  y,
  album,
  onClose,
  onRename,
  onDelete
}: AlbumContextMenuProps) {
  const showRename = canRenameAlbum(album);
  const showDelete = canDeleteAlbum(album);

  // If no actions available, don't show menu
  if (!showRename && !showDelete) {
    onClose();
    return null;
  }

  return (
    <WindowContextMenu
      x={x}
      y={y}
      onClose={onClose}
      backdropTestId="album-context-menu-backdrop"
      menuTestId="album-context-menu"
    >
      {showRename && (
        <button
          type="button"
          className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            onRename(album);
            onClose();
          }}
        >
          Rename
        </button>
      )}
      {showDelete && (
        <button
          type="button"
          className="flex w-full items-center rounded-sm px-2 py-1.5 text-destructive text-sm hover:bg-destructive hover:text-destructive-foreground"
          onClick={() => {
            onDelete(album);
            onClose();
          }}
        >
          Delete
        </button>
      )}
    </WindowContextMenu>
  );
}

// Empty space context menu component
interface EmptySpaceContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onNewAlbum: () => void;
}

function EmptySpaceContextMenu({
  x,
  y,
  onClose,
  onNewAlbum
}: EmptySpaceContextMenuProps) {
  return (
    <WindowContextMenu
      x={x}
      y={y}
      onClose={onClose}
      backdropTestId="empty-space-context-menu-backdrop"
      menuTestId="empty-space-context-menu"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={onNewAlbum}
      >
        <Plus className="h-4 w-4" />
        New Album
      </button>
    </WindowContextMenu>
  );
}
