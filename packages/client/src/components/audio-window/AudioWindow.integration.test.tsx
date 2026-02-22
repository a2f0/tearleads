import '../../test/setupIntegration';

import {
  ALL_AUDIO_ID,
  AudioPlaylistsSidebar,
  useAudioUIContext
} from '@tearleads/audio';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { eq } from 'drizzle-orm';
import { useCallback, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ClientAudioProvider } from '@/contexts/ClientAudioProvider';
import { getDatabase } from '@/db';
import { files, playlists, vfsLinks, vfsRegistry } from '@/db/schema';
import { renderWithDatabase } from '../../test/renderWithDatabase';

function SidebarDropHarness() {
  const { addTrackToPlaylist } = useAudioUIContext();
  const [refreshToken, setRefreshToken] = useState(0);

  const handleDropToPlaylist = useCallback(
    async (playlistId: string, _droppedFiles: File[], audioIds?: string[]) => {
      if (!audioIds || audioIds.length === 0) return;
      try {
        await Promise.all(
          audioIds.map((audioId) => addTrackToPlaylist(playlistId, audioId))
        );
        setRefreshToken((value) => value + 1);
      } catch (_error) {
        // Keep harness resilient to fire-and-forget invocation from sidebar drop handler.
      }
    },
    [addTrackToPlaylist]
  );

  return (
    <AudioPlaylistsSidebar
      width={240}
      onWidthChange={() => {}}
      selectedPlaylistId={ALL_AUDIO_ID}
      onPlaylistSelect={() => {}}
      refreshToken={refreshToken}
      onDropToPlaylist={handleDropToPlaylist}
    />
  );
}

describe('Audio playlist drag and drop integration', () => {
  it('adds dropped track ids to playlist in real database', async () => {
    await renderWithDatabase(
      <ClientAudioProvider>
        <SidebarDropHarness />
      </ClientAudioProvider>,
      {
        beforeRender: async () => {
          const db = getDatabase();
          const now = new Date();

          await db.insert(vfsRegistry).values([
            {
              id: 'playlist-1',
              objectType: 'playlist',
              ownerId: null,
              createdAt: now
            },
            {
              id: 'track-1',
              objectType: 'file',
              ownerId: null,
              createdAt: now
            }
          ]);

          await db.insert(playlists).values({
            id: 'playlist-1',
            encryptedName: 'Road Trip',
            encryptedDescription: null,
            coverImageId: null,
            shuffleMode: 0,
            mediaType: 'audio'
          });

          await db.insert(files).values({
            id: 'track-1',
            name: 'track-1.mp3',
            size: 1024,
            mimeType: 'audio/mpeg',
            uploadDate: now,
            contentHash: 'hash-track-1',
            storagePath: '/audio/track-1.mp3',
            thumbnailPath: null,
            deleted: false
          });
        }
      }
    );

    const playlistButton = await screen.findByRole(
      'button',
      { name: /Road Trip/i },
      { timeout: 4000 }
    );
    expect(playlistButton).toHaveTextContent('0');
    const payload = JSON.stringify({
      mediaType: 'audio',
      ids: ['track-1']
    });
    const dataTransfer = {
      files: [],
      getData: (type: string) =>
        type === 'application/x-tearleads-media-ids' ? payload : ''
    };

    fireEvent.dragEnter(playlistButton, { dataTransfer });
    fireEvent.dragOver(playlistButton, { dataTransfer });
    expect(playlistButton.className).toContain('ring-primary');
    fireEvent.drop(playlistButton, { dataTransfer });

    await waitFor(async () => {
      const db = getDatabase();
      const links = await db
        .select({ id: vfsLinks.id })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, 'playlist-1'));
      expect(links).toHaveLength(1);
    });

    await waitFor(
      () => {
        const updatedPlaylistButton = screen.getByRole('button', {
          name: /Road Trip/i
        });
        expect(updatedPlaylistButton.className).not.toContain('ring-primary');
        expect(updatedPlaylistButton).toHaveTextContent('1');
      },
      { timeout: 4000 }
    );
  });
});
