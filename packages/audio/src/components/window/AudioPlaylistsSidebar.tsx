import {
  detectPlatform,
  useResizableSidebar,
  useSidebarDragOver,
  useSidebarRefetch,
  WindowSidebarError,
  WindowSidebarHeader,
  WindowSidebarItem,
  WindowSidebarLoading
} from '@tearleads/window-manager';
import { Disc, List, Music, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AudioPlaylist } from '../../context/AudioUIContext';
import { parseAlbumId } from '../../lib/albumUtils';
import { filterFilesByAccept } from '../../lib/file-filter';
import { getMediaDragIds } from '../../lib/mediaDragData';
import { AudioPlaylistsContextMenu } from './AudioPlaylistsContextMenu';
import { DeletePlaylistDialog } from './DeletePlaylistDialog';
import { EmptySpaceContextMenu } from './EmptySpaceContextMenu';
import { NewPlaylistDialog } from './NewPlaylistDialog';
import { RenamePlaylistDialog } from './RenamePlaylistDialog';
import { useAudioPlaylists } from './useAudioPlaylists';

export const ALL_AUDIO_ID = '__all__';

interface AudioPlaylistsSidebarProps {
  width: number;
  onWidthChange: (width: number) => void;
  selectedPlaylistId: string | null;
  onPlaylistSelect: (playlistId: string | null) => void;
  /** Currently selected album ID for filtering */
  selectedAlbumId?: string | null;
  /** Callback when album selection changes */
  onAlbumSelect?: (albumId: string | null) => void;
  refreshToken?: number;
  onPlaylistChanged?: () => void;
  /** Callback when files are dropped onto a playlist */
  onDropToPlaylist?: (
    playlistId: string,
    files: File[],
    audioIds?: string[]
  ) => void | Promise<void>;
}

export function AudioPlaylistsSidebar({
  width,
  onWidthChange,
  selectedPlaylistId,
  onPlaylistSelect,
  selectedAlbumId,
  onAlbumSelect,
  refreshToken,
  onPlaylistChanged,
  onDropToPlaylist
}: AudioPlaylistsSidebarProps) {
  const { t } = useTranslation('audio');
  const {
    playlists,
    loading,
    error,
    refetch,
    deletePlaylist,
    renamePlaylist,
    getTrackIdsInPlaylist
  } = useAudioPlaylists();
  const [playlistCounts, setPlaylistCounts] = useState<Record<string, number>>(
    {}
  );

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
        setPlaylistCounts((prev) => {
          const next = { ...prev };
          for (const { id, count } of counts) {
            next[id] = count;
          }
          return next;
        });
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
        console.error('Failed to update audio playlist counts', error);
      }
    },
    [getTrackIdsInPlaylist]
  );

  // Detect platform to disable drag-drop on mobile
  const isNativePlatform = useMemo(() => {
    const platform = detectPlatform();
    return platform === 'ios' || platform === 'android';
  }, []);

  // Track which playlist is being dragged over for visual feedback
  const { dragOverId, handleDragEnter, handleDragLeave, clearDragState } =
    useSidebarDragOver();

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
    [onDropToPlaylist, isNativePlatform, handleDragEnter]
  );

  const handlePlaylistDragLeave = useCallback(
    (e: React.DragEvent, playlistId: string) => {
      if (!onDropToPlaylist || isNativePlatform) return;
      e.preventDefault();
      e.stopPropagation();

      handleDragLeave(playlistId);
    },
    [onDropToPlaylist, isNativePlatform, handleDragLeave]
  );

  const handlePlaylistDrop = useCallback(
    async (e: React.DragEvent, playlistId: string) => {
      if (!onDropToPlaylist || isNativePlatform) return;
      e.preventDefault();
      e.stopPropagation();

      // Reset drag state
      clearDragState(playlistId);

      const audioIds = getMediaDragIds(e.dataTransfer, 'audio');
      const files = Array.from(e.dataTransfer.files);
      const audioFiles = filterFilesByAccept(files, 'audio/*');

      try {
        if (audioIds.length > 0) {
          await onDropToPlaylist(playlistId, [], audioIds);
        } else if (audioFiles.length > 0) {
          await onDropToPlaylist(playlistId, audioFiles);
        } else {
          return;
        }

        await refetch();
        onPlaylistChanged?.();
        await updatePlaylistCounts([playlistId]);
      } catch (error) {
        console.error('Failed to handle audio playlist drop', error);
      }
    },
    [
      onDropToPlaylist,
      isNativePlatform,
      clearDragState,
      onPlaylistChanged,
      refetch,
      updatePlaylistCounts
    ]
  );

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

  const [emptySpaceContextMenu, setEmptySpaceContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  useSidebarRefetch(refreshToken, refetch);

  useEffect(() => {
    if (playlists.length === 0) return;
    void updatePlaylistCounts(playlists.map((p) => p.id));
  }, [playlists, updatePlaylistCounts]);

  const { resizeHandleProps } = useResizableSidebar({
    width,
    onWidthChange,
    ariaLabel: 'Resize playlist sidebar'
  });

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, playlist: AudioPlaylist) => {
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
      <WindowSidebarHeader
        title={t('playlists')}
        actionLabel={t('playlistName')}
        onAction={() => setNewPlaylistDialogOpen(true)}
        actionIcon={<Plus className="h-4 w-4" />}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Context menu on empty space */}
      <div
        className="flex-1 overflow-y-auto p-1"
        onContextMenu={handleEmptySpaceContextMenu}
      >
        <WindowSidebarItem
          label={t('allTracks')}
          icon={<Music className="h-4 w-4 shrink-0 text-primary" />}
          selected={
            (selectedPlaylistId === ALL_AUDIO_ID ||
              selectedPlaylistId === null) &&
            !selectedAlbumId
          }
          onClick={() => {
            onPlaylistSelect(ALL_AUDIO_ID);
            onAlbumSelect?.(null);
          }}
          leadingSpacer
        />

        {selectedAlbumId && (
          <div className="mx-1 mb-1 flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1.5 text-xs">
            <Disc className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="flex-1 truncate font-medium">
              {parseAlbumId(selectedAlbumId)?.name ?? t('unknownAlbum')}
            </span>
            <button
              type="button"
              onClick={() => onAlbumSelect?.(null)}
              className="rounded p-0.5 hover:bg-primary/20"
              aria-label={t('clearAlbumFilter')}
              data-testid="clear-album-filter"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {loading && <WindowSidebarLoading />}
        {error && <WindowSidebarError message={error} />}
        {!loading &&
          !error &&
          playlists.map((playlist) => (
            <WindowSidebarItem
              key={playlist.id}
              label={playlist.name}
              icon={<List className="h-4 w-4 shrink-0 text-primary" />}
              selected={selectedPlaylistId === playlist.id}
              className={
                dragOverId === playlist.id
                  ? 'bg-primary/10 ring-2 ring-primary ring-inset'
                  : undefined
              }
              onClick={() => onPlaylistSelect(playlist.id)}
              onContextMenu={(e) => handleContextMenu(e, playlist)}
              onDragOver={(e) => handlePlaylistDragOver(e, playlist.id)}
              onDragEnter={(e) => handlePlaylistDragEnter(e, playlist.id)}
              onDragLeave={(e) => handlePlaylistDragLeave(e, playlist.id)}
              onDrop={(e) => handlePlaylistDrop(e, playlist.id)}
              count={playlistCounts[playlist.id] ?? playlist.trackCount}
              leadingSpacer
            />
          ))}
      </div>
      <hr
        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize border-0 bg-transparent hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
        {...resizeHandleProps}
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

      {emptySpaceContextMenu && (
        <EmptySpaceContextMenu
          x={emptySpaceContextMenu.x}
          y={emptySpaceContextMenu.y}
          onClose={() => setEmptySpaceContextMenu(null)}
          onNewPlaylist={() => {
            setNewPlaylistDialogOpen(true);
            setEmptySpaceContextMenu(null);
          }}
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
