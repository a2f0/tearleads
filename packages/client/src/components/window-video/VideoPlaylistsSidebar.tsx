import {
  useResizableSidebar,
  useSidebarDragOver,
  useSidebarRefetch
} from '@tearleads/window-manager';
import { List, Loader2, Plus, Video } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoPlaylists } from '@/hooks/media';
import { filterFilesByAccept } from '@/lib/fileFilter';
import { getMediaDragIds } from '@/lib/mediaDragData';
import { cn, detectPlatform } from '@/lib/utils';
import type { VideoPlaylist } from '@/video/VideoPlaylistContext';
import { DeleteVideoPlaylistDialog } from './DeleteVideoPlaylistDialog';
import { NewVideoPlaylistDialog } from './NewVideoPlaylistDialog';
import { RenameVideoPlaylistDialog } from './RenameVideoPlaylistDialog';
import { VideoEmptySpaceContextMenu } from './VideoEmptySpaceContextMenu';
import { VideoPlaylistsContextMenu } from './VideoPlaylistsContextMenu';

export const ALL_VIDEO_ID = '__all__';

interface VideoPlaylistsSidebarProps {
  width: number;
  onWidthChange: (width: number) => void;
  selectedPlaylistId: string | null;
  onPlaylistSelect: (playlistId: string | null) => void;
  refreshToken?: number;
  onPlaylistChanged?: () => void;
  /** Callback when files are dropped onto a playlist */
  onDropToPlaylist?: (
    playlistId: string,
    files: File[],
    videoIds?: string[]
  ) => void | Promise<void>;
}

export function VideoPlaylistsSidebar({
  width,
  onWidthChange,
  selectedPlaylistId,
  onPlaylistSelect,
  refreshToken,
  onPlaylistChanged,
  onDropToPlaylist
}: VideoPlaylistsSidebarProps) {
  const {
    playlists,
    loading,
    error,
    refetch,
    deletePlaylist,
    renamePlaylist,
    getTrackIdsInPlaylist
  } = useVideoPlaylists();
  const [playlistCounts, setPlaylistCounts] = useState<Record<string, number>>(
    {}
  );
  const playlistCountsRef = useRef<Record<string, number>>({});

  const updatePlaylistCounts = useCallback(
    async (playlistIds: string[]) => {
      if (playlistIds.length === 0) return;
      try {
        const uniqueIds = Array.from(new Set(playlistIds));
        const counts = await Promise.all(
          uniqueIds.map(async (id) => {
            const idsInPlaylist = await getTrackIdsInPlaylist(id);
            return { id, count: idsInPlaylist.length };
          })
        );
        const next = { ...playlistCountsRef.current };
        let hasChanges = false;
        for (const { id, count } of counts) {
          if (next[id] !== count) {
            next[id] = count;
            hasChanges = true;
          }
        }
        if (!hasChanges) return;
        playlistCountsRef.current = next;
        setPlaylistCounts(next);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? '');
        const causeMessage =
          error && typeof error === 'object' && 'cause' in error
            ? String((error as { cause?: unknown }).cause ?? '')
            : '';
        if (
          message.includes('Database not initialized') ||
          causeMessage.includes('Database not initialized')
        ) {
          return;
        }
        console.error('Failed to update video playlist counts', error);
      }
    },
    [getTrackIdsInPlaylist]
  );

  const {
    dragOverId: dragOverPlaylistId,
    handleDragEnter,
    handleDragLeave,
    clearDragState
  } = useSidebarDragOver();
  const platform = detectPlatform();
  const isNativePlatform = platform === 'ios' || platform === 'android';

  const handlePlaylistDragOver = useCallback(
    (e: React.DragEvent, _playlistId: string) => {
      if (!onDropToPlaylist || isNativePlatform) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [onDropToPlaylist, isNativePlatform]
  );

  const handlePlaylistDragEnter = useCallback(
    (e: React.DragEvent, playlistId: string) => {
      if (!onDropToPlaylist || isNativePlatform) return;
      e.preventDefault();
      e.stopPropagation();
      handleDragEnter(playlistId);
    },
    [handleDragEnter, onDropToPlaylist, isNativePlatform]
  );

  const handlePlaylistDragLeave = useCallback(
    (e: React.DragEvent, playlistId: string) => {
      if (!onDropToPlaylist || isNativePlatform) return;
      e.preventDefault();
      e.stopPropagation();
      handleDragLeave(playlistId);
    },
    [handleDragLeave, onDropToPlaylist, isNativePlatform]
  );

  const handlePlaylistDrop = useCallback(
    async (e: React.DragEvent, playlistId: string) => {
      if (!onDropToPlaylist || isNativePlatform) return;
      e.preventDefault();
      e.stopPropagation();

      clearDragState(playlistId);

      const videoIds = getMediaDragIds(e.dataTransfer, 'video');
      const files = Array.from(e.dataTransfer.files);
      const videoFiles = filterFilesByAccept(files, 'video/*');

      try {
        if (videoIds.length > 0) {
          await onDropToPlaylist(playlistId, [], videoIds);
        } else if (videoFiles.length > 0) {
          await onDropToPlaylist(playlistId, videoFiles);
        } else {
          return;
        }

        await refetch();
        onPlaylistChanged?.();
        await updatePlaylistCounts([playlistId]);
      } catch (error) {
        console.error('Failed to handle video playlist drop', error);
      }
    },
    [
      onDropToPlaylist,
      clearDragState,
      isNativePlatform,
      onPlaylistChanged,
      refetch,
      updatePlaylistCounts
    ]
  );

  const [newPlaylistDialogOpen, setNewPlaylistDialogOpen] = useState(false);
  const [renameDialogPlaylist, setRenameDialogPlaylist] =
    useState<VideoPlaylist | null>(null);
  const [deleteDialogPlaylist, setDeleteDialogPlaylist] =
    useState<VideoPlaylist | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    playlist: VideoPlaylist;
  } | null>(null);

  const [emptySpaceContextMenu, setEmptySpaceContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  useSidebarRefetch(refreshToken, refetch);

  useEffect(() => {
    if (playlists.length === 0) return;
    const idsNeedingLookup: string[] = [];
    const baselineCounts: Record<string, number> = {};
    for (const playlist of playlists) {
      if (typeof playlist.trackCount === 'number') {
        baselineCounts[playlist.id] = playlist.trackCount;
      } else {
        idsNeedingLookup.push(playlist.id);
      }
    }
    playlistCountsRef.current = baselineCounts;
    setPlaylistCounts(baselineCounts);
    if (idsNeedingLookup.length > 0) {
      void updatePlaylistCounts(idsNeedingLookup);
    }
  }, [playlists, updatePlaylistCounts]);

  const { resizeHandleProps } = useResizableSidebar({
    width,
    onWidthChange,
    ariaLabel: 'Resize playlist sidebar'
  });

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, playlist: VideoPlaylist) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, playlist });
    },
    []
  );

  const handleEmptySpaceContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setEmptySpaceContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handlePlaylistChanged = useCallback(() => {
    refetch();
    onPlaylistChanged?.();
  }, [refetch, onPlaylistChanged]);

  const handlePlaylistDeleted = useCallback(
    (deletedId: string) => {
      if (selectedPlaylistId === deletedId) {
        onPlaylistSelect(ALL_VIDEO_ID);
      }
      handlePlaylistChanged();
    },
    [handlePlaylistChanged, onPlaylistSelect, selectedPlaylistId]
  );

  return (
    <div
      className="relative flex shrink-0 flex-col border-r bg-muted/20"
      style={{ width }}
      data-testid="video-playlists-sidebar"
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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Context menu on empty space */}
      <div
        className="flex-1 overflow-y-auto p-1"
        onContextMenu={handleEmptySpaceContextMenu}
      >
        <button
          type="button"
          className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors ${
            selectedPlaylistId === ALL_VIDEO_ID || selectedPlaylistId === null
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50'
          }`}
          style={{ paddingLeft: '8px' }}
          onClick={() => onPlaylistSelect(ALL_VIDEO_ID)}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center" />
          <Video className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">All Videos</span>
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
              className={cn(
                'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors',
                selectedPlaylistId === playlist.id
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50',
                dragOverPlaylistId === playlist.id &&
                  'bg-primary/10 ring-2 ring-primary ring-inset'
              )}
              style={{ paddingLeft: '8px' }}
              onClick={() => onPlaylistSelect(playlist.id)}
              onContextMenu={(e) => handleContextMenu(e, playlist)}
              onDragOver={(e) => handlePlaylistDragOver(e, playlist.id)}
              onDragEnter={(e) => handlePlaylistDragEnter(e, playlist.id)}
              onDragLeave={(e) => handlePlaylistDragLeave(e, playlist.id)}
              onDrop={(e) => handlePlaylistDrop(e, playlist.id)}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center" />
              <List className="h-4 w-4 shrink-0 text-primary" />
              <span className="flex-1 truncate">{playlist.name}</span>
              <span className="text-muted-foreground text-xs">
                {playlistCounts[playlist.id] ?? playlist.trackCount}
              </span>
            </button>
          ))}
      </div>
      <hr
        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize border-0 bg-transparent hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
        {...resizeHandleProps}
      />

      {contextMenu && (
        <VideoPlaylistsContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          playlist={contextMenu.playlist}
          onClose={() => setContextMenu(null)}
          onRename={(playlist) => setRenameDialogPlaylist(playlist)}
          onDelete={(playlist) => setDeleteDialogPlaylist(playlist)}
        />
      )}

      {emptySpaceContextMenu && (
        <VideoEmptySpaceContextMenu
          x={emptySpaceContextMenu.x}
          y={emptySpaceContextMenu.y}
          onClose={() => setEmptySpaceContextMenu(null)}
          onNewPlaylist={() => {
            setNewPlaylistDialogOpen(true);
            setEmptySpaceContextMenu(null);
          }}
        />
      )}

      <NewVideoPlaylistDialog
        open={newPlaylistDialogOpen}
        onOpenChange={setNewPlaylistDialogOpen}
        onPlaylistCreated={handlePlaylistChanged}
      />

      <RenameVideoPlaylistDialog
        open={renameDialogPlaylist !== null}
        onOpenChange={(open) => {
          if (!open) setRenameDialogPlaylist(null);
        }}
        playlist={renameDialogPlaylist}
        onRename={renamePlaylist}
        onPlaylistRenamed={handlePlaylistChanged}
      />

      <DeleteVideoPlaylistDialog
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
