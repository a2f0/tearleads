import { ALL_AUDIO_ID, AudioPlaylistsSidebar } from '@tearleads/app-audio';
import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '@/components/ui/back-link';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { linkAudioToPlaylist } from '@/lib/linkAudioToPlaylist';
import { AudioPage } from './AudioPage';

export function AudioWithSidebar() {
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
