import '../../test/setupIntegration';

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { eq } from 'drizzle-orm';
import { useCallback, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ClientVideoProvider } from '@/contexts/ClientVideoProvider';
import { getDatabase } from '@/db';
import { files, playlists, vfsLinks, vfsRegistry } from '@/db/schema';
import { useVideoPlaylistContext } from '@/video/VideoPlaylistContext';
import { renderWithDatabase } from '../../test/renderWithDatabase';
import { ALL_VIDEO_ID, VideoPlaylistsSidebar } from './VideoPlaylistsSidebar';

function SidebarDropHarness() {
  const { addTrackToPlaylist } = useVideoPlaylistContext();
  const [refreshToken, setRefreshToken] = useState(0);

  const handleDropToPlaylist = useCallback(
    async (playlistId: string, _droppedFiles: File[], videoIds?: string[]) => {
      if (!videoIds || videoIds.length === 0) return;
      try {
        await Promise.all(
          videoIds.map((videoId) => addTrackToPlaylist(playlistId, videoId))
        );
        setRefreshToken((value) => value + 1);
      } catch (_error) {
        // Keep harness resilient to fire-and-forget invocation from sidebar drop handler.
      }
    },
    [addTrackToPlaylist]
  );

  return (
    <VideoPlaylistsSidebar
      width={240}
      onWidthChange={() => {}}
      selectedPlaylistId={ALL_VIDEO_ID}
      onPlaylistSelect={() => {}}
      refreshToken={refreshToken}
      onDropToPlaylist={handleDropToPlaylist}
    />
  );
}

describe('Video playlist drag and drop integration', () => {
  it('updates playlist count after dropping video ids from All Videos list', async () => {
    await renderWithDatabase(
      <ClientVideoProvider>
        <SidebarDropHarness />
      </ClientVideoProvider>,
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
              id: 'video-1',
              objectType: 'file',
              ownerId: null,
              createdAt: now
            }
          ]);

          await db.insert(playlists).values({
            id: 'playlist-1',
            encryptedName: 'Movies',
            encryptedDescription: null,
            coverImageId: null,
            shuffleMode: 0,
            mediaType: 'video'
          });

          await db.insert(files).values({
            id: 'video-1',
            name: 'video-1.mp4',
            size: 2048,
            mimeType: 'video/mp4',
            uploadDate: now,
            contentHash: 'hash-video-1',
            storagePath: '/videos/video-1.mp4',
            thumbnailPath: null,
            deleted: false
          });
        }
      }
    );

    const playlistButton = await screen.findByRole(
      'button',
      { name: /Movies/i },
      { timeout: 4000 }
    );
    expect(playlistButton).toHaveTextContent('0');
    const payload = JSON.stringify({ mediaType: 'video', ids: ['video-1'] });
    const dataTransfer = {
      files: [],
      getData: (type: string) =>
        type === 'application/x-tearleads-media-ids' ? payload : ''
    };

    fireEvent.dragOver(playlistButton, { dataTransfer });
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
          name: /Movies/i
        });
        expect(updatedPlaylistButton).toHaveTextContent('1');
      },
      { timeout: 4000 }
    );
  });
});
