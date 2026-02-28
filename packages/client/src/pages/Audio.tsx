import { useVirtualizer } from '@tanstack/react-virtual';
import { ALL_AUDIO_ID, AudioPlaylistsSidebar } from '@tearleads/audio';
import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import { Info, Music, Pause, Play, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAudio } from '@/audio';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { ClientAudioProvider } from '@/contexts/ClientAudioProvider';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { useVirtualVisibleRange } from '@/hooks/device';
import { useAudioErrorHandler } from '@/hooks/media';
import { useTypedTranslation } from '@/i18n';
import { linkAudioToPlaylist } from '@/lib/linkAudioToPlaylist';
import { detectPlatform } from '@/lib/utils';
import {
  renderAudioContent,
  type AudioContentHandlers,
  type AudioContentState,
  type AudioListVirtualState
} from './audio-components/AudioPageContent';
import type { AudioPageProps } from './audio-components/types';
import { ROW_HEIGHT_ESTIMATE } from './audio-components/types';
import { useAudioActions } from './audio-components/useAudioActions';
import { useAudioData } from './audio-components/useAudioData';
import { useAudioUpload } from './audio-components/useAudioUpload';

export function AudioPage({
  playlistId = null,
  hideBackLink = false
}: AudioPageProps = {}) {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const { currentTrack, isPlaying } = useAudio();
  const { t } = useTypedTranslation('contextMenu');
  useAudioErrorHandler();
  const parentRef = useRef<HTMLDivElement>(null);

  const {
    tracks,
    setTracks,
    loading,
    error,
    setError,
    hasFetched,
    setHasFetched,
    fetchTracks
  } = useAudioData(playlistId);

  const { uploading, uploadProgress, handleFilesSelected } = useAudioUpload(
    setError,
    setHasFetched
  );

  const {
    contextMenu,
    handlePlayPause,
    handleNavigateToDetail,
    handleContextMenu,
    handleCloseContextMenu,
    handleGetInfo,
    handleContextMenuPlay,
    handleDelete
  } = useAudioActions(setTracks, setError);

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();
  const { firstVisible, lastVisible } = useVirtualVisibleRange(virtualItems);

  const isDesktopPlatform = useMemo(() => {
    const platform = detectPlatform();
    return platform === 'web' || platform === 'electron';
  }, []);

  const contentState: AudioContentState = {
    isUnlocked,
    loading,
    hasFetched,
    uploading,
    uploadProgress,
    tracks,
    isDesktopPlatform,
    error
  };

  const contentHandlers: AudioContentHandlers = {
    handleFilesSelected,
    handlePlayPause,
    handleNavigateToDetail,
    handleContextMenu
  };

  const listVirtualState: AudioListVirtualState = {
    virtualizer,
    virtualItems,
    firstVisible,
    lastVisible,
    parentRef,
    currentTrack,
    isPlaying
  };

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        {!hideBackLink && (
          <BackLink defaultTo="/" defaultLabel="Back to Home" />
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Music className="h-8 w-8 text-muted-foreground" />
            <h1 className="font-bold text-2xl tracking-tight">Audio</h1>
          </div>
          {isUnlocked && (
            <RefreshButton onClick={fetchTracks} loading={loading} />
          )}
        </div>
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="audio" />}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {renderAudioContent(contentState, contentHandlers, listVirtualState)}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          <ContextMenuItem
            icon={
              contextMenu.track.id === currentTrack?.id && isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )
            }
            onClick={() => handleContextMenuPlay(contextMenu.track)}
          >
            {contextMenu.track.id === currentTrack?.id && isPlaying
              ? t('pause')
              : t('play')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={() => handleGetInfo(contextMenu.track)}
          >
            {t('getInfo')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => handleDelete(contextMenu.track)}
          >
            {t('delete')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}

function AudioWithSidebar() {
  const { playlistId } = useParams<{ playlistId?: string }>();
  const navigate = useNavigate();
  const { isUnlocked } = useDatabaseContext();
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [refreshToken, setRefreshToken] = useState(0);

  // Derive selected playlist from URL (or ALL_AUDIO_ID if no param)
  const selectedPlaylistId = playlistId ?? ALL_AUDIO_ID;

  // Navigate on playlist selection
  const handlePlaylistSelect = useCallback(
    (id: string | null) => {
      if (id === ALL_AUDIO_ID || id === null) {
        navigate('/audio');
      } else {
        navigate(`/audio/playlists/${id}`);
      }
    },
    [navigate]
  );

  const handleDropToPlaylist = useCallback(
    async (playlistId: string, files: File[], audioIds?: string[]) => {
      void files;
      if (!audioIds || audioIds.length === 0) return;
      const db = getDatabase();
      const insertedCount = await linkAudioToPlaylist(db, playlistId, audioIds);
      if (insertedCount > 0) {
        setRefreshToken((value) => value + 1);
      }
    },
    []
  );

  return (
    <div className="flex h-full flex-col space-y-4">
      <BackLink defaultTo="/" defaultLabel="Back to Home" />
      <div className="flex min-h-0 flex-1">
        {isUnlocked && (
          <div className="hidden md:block">
            <AudioPlaylistsSidebar
              width={sidebarWidth}
              onWidthChange={setSidebarWidth}
              selectedPlaylistId={selectedPlaylistId}
              onPlaylistSelect={handlePlaylistSelect}
              refreshToken={refreshToken}
              onPlaylistChanged={() => setRefreshToken((t) => t + 1)}
              onDropToPlaylist={handleDropToPlaylist}
            />
          </div>
        )}
        <div className="min-w-0 flex-1 overflow-hidden md:pl-4">
          <AudioPage
            hideBackLink
            playlistId={
              selectedPlaylistId === ALL_AUDIO_ID ? null : selectedPlaylistId
            }
          />
        </div>
      </div>
    </div>
  );
}

export function Audio() {
  return (
    <ClientAudioProvider>
      <AudioWithSidebar />
    </ClientAudioProvider>
  );
}
