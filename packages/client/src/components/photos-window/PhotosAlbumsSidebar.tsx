import { ImagePlus, Images, Loader2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { DeleteAlbumDialog } from './DeleteAlbumDialog';
import { NewAlbumDialog } from './NewAlbumDialog';
import { RenameAlbumDialog } from './RenameAlbumDialog';
import { type PhotoAlbum, usePhotoAlbums } from './usePhotoAlbums';

// Special ID for showing all photos
export const ALL_PHOTOS_ID = '__all__';

interface AlbumContextMenuState {
  x: number;
  y: number;
  album: PhotoAlbum;
}

interface PhotosAlbumsSidebarProps {
  width: number;
  onWidthChange: (width: number) => void;
  selectedAlbumId: string | null;
  onAlbumSelect: (albumId: string | null) => void;
  refreshToken?: number;
  onAlbumChanged?: () => void;
}

export function PhotosAlbumsSidebar({
  width,
  onWidthChange,
  selectedAlbumId,
  onAlbumSelect,
  refreshToken: _refreshToken,
  onAlbumChanged
}: PhotosAlbumsSidebarProps) {
  const { albums, loading, error, refetch, deleteAlbum, renameAlbum } =
    usePhotoAlbums();

  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;

      const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = e.clientX - startX.current;
        const newWidth = Math.max(
          150,
          Math.min(400, startWidth.current + delta)
        );
        onWidthChange(newWidth);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [width, onWidthChange]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, album: PhotoAlbum) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, album });
    },
    []
  );

  const handleAlbumChanged = useCallback(() => {
    refetch();
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

  return (
    <div
      className="relative flex shrink-0 flex-col border-r bg-muted/20"
      style={{ width }}
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="font-medium text-muted-foreground text-xs">
          Albums
        </span>
        <button
          type="button"
          onClick={() => setNewAlbumDialogOpen(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="New Album"
        >
          <ImagePlus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {/* All Photos - always shown */}
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors',
            selectedAlbumId === ALL_PHOTOS_ID || selectedAlbumId === null
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50'
          )}
          style={{ paddingLeft: '8px' }}
          onClick={() => onAlbumSelect(ALL_PHOTOS_ID)}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center" />
          <Images className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
          <span className="truncate">All Photos</span>
        </button>

        {loading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="px-2 py-4 text-center text-destructive text-xs">
            {error}
          </div>
        )}
        {!loading &&
          !error &&
          albums.map((album) => (
            <button
              key={album.id}
              type="button"
              className={cn(
                'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors',
                selectedAlbumId === album.id
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              )}
              style={{ paddingLeft: '8px' }}
              onClick={() => onAlbumSelect(album.id)}
              onContextMenu={(e) => handleContextMenu(e, album)}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center" />
              <Images className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
              <span className="flex-1 truncate">{album.name}</span>
              <span className="text-muted-foreground text-xs">
                {album.photoCount}
              </span>
            </button>
          ))}
      </div>
      {/* Resize handle */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Resize handle for panel width */}
      <div
        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-accent"
        onMouseDown={handleMouseDown}
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
        onRename={renameAlbum}
        onAlbumRenamed={handleAlbumChanged}
      />

      {/* Delete Dialog */}
      <DeleteAlbumDialog
        open={deleteDialogAlbum !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogAlbum(null);
        }}
        album={deleteDialogAlbum}
        onDelete={deleteAlbum}
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
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  const handleBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop click handler */}
      <div
        className="fixed inset-0 z-40"
        onClick={handleBackdropClick}
        aria-hidden="true"
        data-testid="album-context-menu-backdrop"
      />
      <div
        ref={menuRef}
        className="fixed z-50 min-w-[160px] rounded-md border bg-popover p-1 shadow-md"
        style={{ left: x, top: y }}
        data-testid="album-context-menu"
      >
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
      </div>
    </>
  );
}
