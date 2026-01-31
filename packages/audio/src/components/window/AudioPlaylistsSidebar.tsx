import { List, Loader2, Music, Plus } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { AudioPlaylist } from '../../context/AudioUIContext';
import { AudioPlaylistsContextMenu } from './AudioPlaylistsContextMenu';
import { DeletePlaylistDialog } from './DeletePlaylistDialog';
import { NewPlaylistDialog } from './NewPlaylistDialog';
import { RenamePlaylistDialog } from './RenamePlaylistDialog';
import { useAudioPlaylists } from './useAudioPlaylists';

export const ALL_AUDIO_ID = '__all__';

interface AudioPlaylistsSidebarProps {
  width: number;
  onWidthChange: (width: number) => void;
  selectedPlaylistId: string | null;
  onPlaylistSelect: (playlistId: string | null) => void;
  onPlaylistChanged?: () => void;
}

export function AudioPlaylistsSidebar({
  width,
  onWidthChange,
  selectedPlaylistId,
  onPlaylistSelect,
  onPlaylistChanged
}: AudioPlaylistsSidebarProps) {
  const { playlists, loading, error, refetch, deletePlaylist, renamePlaylist } =
    useAudioPlaylists();

  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const [newPlaylistDialogOpen, setNewPlaylistDialogOpen] = useState(false);
  const [renameDialogPlaylist, setRenameDialogPlaylist] =
    useState<AudioPlaylist | null>(null);
  const [deleteDialogPlaylist, setDeleteDialogPlaylist] =
    useState<AudioPlaylist | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    playlist: AudioPlaylist;
  } | null>(null);

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
    [onWidthChange, width]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, playlist: AudioPlaylist) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, playlist });
    },
    []
  );

  const handlePlaylistChanged = useCallback(() => {
    refetch();
    onPlaylistChanged?.();
  }, [refetch, onPlaylistChanged]);

  const handlePlaylistDeleted = useCallback(
    (deletedId: string) => {
      if (selectedPlaylistId === deletedId) {
        onPlaylistSelect(ALL_AUDIO_ID);
      }
      handlePlaylistChanged();
    },
    [handlePlaylistChanged, onPlaylistSelect, selectedPlaylistId]
  );

  return (
    <div
      className="relative flex shrink-0 flex-col border-r bg-muted/20"
      style={{ width }}
      data-testid="audio-playlists-sidebar"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="font-medium text-muted-foreground text-xs">
          Playlists
        </span>
        <button
          type="button"
          onClick={() => setNewPlaylistDialogOpen(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="New Playlist"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        <button
          type="button"
          className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors ${
            selectedPlaylistId === ALL_AUDIO_ID || selectedPlaylistId === null
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50'
          }`}
          style={{ paddingLeft: '8px' }}
          onClick={() => onPlaylistSelect(ALL_AUDIO_ID)}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center" />
          <Music className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">All Tracks</span>
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
          playlists.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors ${
                selectedPlaylistId === playlist.id
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              }`}
              style={{ paddingLeft: '8px' }}
              onClick={() => onPlaylistSelect(playlist.id)}
              onContextMenu={(e) => handleContextMenu(e, playlist)}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center" />
              <List className="h-4 w-4 shrink-0 text-primary" />
              <span className="flex-1 truncate">{playlist.name}</span>
              <span className="text-muted-foreground text-xs">
                {playlist.trackCount}
              </span>
            </button>
          ))}
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Resize handle for panel width */}
      <div
        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-accent"
        onMouseDown={handleMouseDown}
      />

      {contextMenu && (
        <AudioPlaylistsContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          playlist={contextMenu.playlist}
          onClose={() => setContextMenu(null)}
          onRename={(playlist) => setRenameDialogPlaylist(playlist)}
          onDelete={(playlist) => setDeleteDialogPlaylist(playlist)}
        />
      )}

      <NewPlaylistDialog
        open={newPlaylistDialogOpen}
        onOpenChange={setNewPlaylistDialogOpen}
        onPlaylistCreated={handlePlaylistChanged}
      />

      <RenamePlaylistDialog
        open={renameDialogPlaylist !== null}
        onOpenChange={(open) => {
          if (!open) setRenameDialogPlaylist(null);
        }}
        playlist={renameDialogPlaylist}
        onRename={renamePlaylist}
        onPlaylistRenamed={handlePlaylistChanged}
      />

      <DeletePlaylistDialog
        open={deleteDialogPlaylist !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogPlaylist(null);
        }}
        playlist={deleteDialogPlaylist}
        onDelete={deletePlaylist}
        onPlaylistDeleted={handlePlaylistDeleted}
      />
    </div>
  );
}
