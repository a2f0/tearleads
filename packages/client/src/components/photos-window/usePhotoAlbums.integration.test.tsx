import '../../test/setupIntegration';

import { eq } from 'drizzle-orm';
import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase } from '@/db';
import { albums } from '@/db/schema';
import { renderWithDatabase } from '../../test/renderWithDatabase';
import { resetSystemAlbumInitGuard, usePhotoAlbums } from './usePhotoAlbums';

/**
 * Three sibling components that each call usePhotoAlbums(), reproducing
 * the real-world scenario (PhotosWindow + PhotosAlbumsSidebar + NewAlbumDialog)
 * that caused duplicate Photo Roll creation.
 */
function AlbumConsumerA() {
  const { albums: list, hasFetched } = usePhotoAlbums();
  return (
    <div data-testid="consumer-a" data-fetched={hasFetched}>
      {list.map((a) => (
        <span key={a.id}>{a.name}</span>
      ))}
    </div>
  );
}

function AlbumConsumerB() {
  const { albums: list, hasFetched } = usePhotoAlbums();
  return (
    <div data-testid="consumer-b" data-fetched={hasFetched}>
      {list.map((a) => (
        <span key={a.id}>{a.name}</span>
      ))}
    </div>
  );
}

function AlbumConsumerC() {
  const { albums: list, hasFetched } = usePhotoAlbums();
  return (
    <div data-testid="consumer-c" data-fetched={hasFetched}>
      {list.map((a) => (
        <span key={a.id}>{a.name}</span>
      ))}
    </div>
  );
}

function TripleConsumer() {
  return (
    <>
      <AlbumConsumerA />
      <AlbumConsumerB />
      <AlbumConsumerC />
    </>
  );
}

describe('usePhotoAlbums concurrent initialization', () => {
  beforeEach(() => {
    resetSystemAlbumInitGuard();
  });

  it('creates exactly one Photo Roll when 3 components mount simultaneously', async () => {
    const result = await renderWithDatabase(<TripleConsumer />);

    // Wait for all consumers to finish fetching
    await waitFor(() => {
      const a = result.getByTestId('consumer-a');
      const b = result.getByTestId('consumer-b');
      const c = result.getByTestId('consumer-c');
      expect(a.getAttribute('data-fetched')).toBe('true');
      expect(b.getAttribute('data-fetched')).toBe('true');
      expect(c.getAttribute('data-fetched')).toBe('true');
    });

    // Query the real database: there must be exactly one photoroll album
    const db = getDatabase();
    const photoRolls = await db
      .select({ id: albums.id, name: albums.encryptedName })
      .from(albums)
      .where(eq(albums.albumType, 'photoroll'));

    expect(photoRolls).toHaveLength(1);
    expect(photoRolls[0]?.name).toBe('Photo Roll');
  });
});
