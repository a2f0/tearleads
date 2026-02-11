import '../../test/setup-integration';

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { eq } from 'drizzle-orm';
import { useCallback, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { getDatabase } from '@/db';
import { albums, files, vfsLinks, vfsRegistry } from '@/db/schema';
import { renderWithDatabase } from '../../test/render-with-database';
import { ALL_PHOTOS_ID, PhotosAlbumsSidebar } from './PhotosAlbumsSidebar';
import { usePhotoAlbums } from './usePhotoAlbums';

function PhotosSidebarDropHarness() {
  const { addPhotoToAlbum } = usePhotoAlbums();
  const [refreshToken, setRefreshToken] = useState(0);

  const handleDropToAlbum = useCallback(
    async (albumId: string, _files: File[], photoIds?: string[]) => {
      if (!photoIds || photoIds.length === 0) return;
      await Promise.all(
        photoIds.map((photoId) => addPhotoToAlbum(albumId, photoId))
      );
      setRefreshToken((value) => value + 1);
    },
    [addPhotoToAlbum]
  );

  return (
    <PhotosAlbumsSidebar
      width={240}
      onWidthChange={() => {}}
      selectedAlbumId={ALL_PHOTOS_ID}
      onAlbumSelect={() => {}}
      refreshToken={refreshToken}
      onDropToAlbum={handleDropToAlbum}
    />
  );
}

describe('Photos album drag and drop integration', () => {
  it('adds dropped photo ids to album in real database', async () => {
    await renderWithDatabase(<PhotosSidebarDropHarness />, {
      beforeRender: async () => {
        const db = getDatabase();
        const now = new Date();

        await db.insert(vfsRegistry).values([
          {
            id: 'album-1',
            objectType: 'album',
            ownerId: null,
            createdAt: now
          },
          {
            id: 'photo-1',
            objectType: 'file',
            ownerId: null,
            createdAt: now
          }
        ]);

        await db.insert(albums).values({
          id: 'album-1',
          encryptedName: 'Travel',
          encryptedDescription: null,
          coverPhotoId: null
        });

        await db.insert(files).values({
          id: 'photo-1',
          name: 'photo-1.jpg',
          size: 1024,
          mimeType: 'image/jpeg',
          uploadDate: now,
          contentHash: 'hash-photo-1',
          storagePath: '/photos/photo-1.jpg',
          thumbnailPath: null,
          deleted: false
        });
      }
    });

    await waitFor(() => {
      const albumButton = screen.getByRole('button', { name: /Travel/i });
      expect(albumButton).toHaveTextContent('0');
    });

    const albumButton = screen.getByRole('button', { name: /Travel/i });
    const payload = JSON.stringify({ mediaType: 'image', ids: ['photo-1'] });
    const dataTransfer = {
      files: [],
      getData: (type: string) =>
        type === 'application/x-tearleads-media-ids' ? payload : ''
    };

    fireEvent.dragOver(albumButton, { dataTransfer });
    fireEvent.drop(albumButton, { dataTransfer });

    await waitFor(async () => {
      const db = getDatabase();
      const links = await db
        .select({ id: vfsLinks.id })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, 'album-1'));
      expect(links).toHaveLength(1);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Travel/i })).toHaveTextContent(
        '1'
      );
    });

    fireEvent.drop(albumButton, { dataTransfer });

    await waitFor(async () => {
      const db = getDatabase();
      const links = await db
        .select({ id: vfsLinks.id })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, 'album-1'));
      expect(links).toHaveLength(1);
    });
  });
});
