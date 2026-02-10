import '@/test/setup-integration';
import { withRealDatabase } from '@rapid/db-test-utils';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { files, playlists, vfsLinks, vfsRegistry } from '@/db/schema';
import { migrations } from '../db/migrations';
import { linkAudioToPlaylist } from './linkAudioToPlaylist';

describe('linkAudioToPlaylist', () => {
  it('registers missing tracks in VFS and links to playlist', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const now = new Date();

        await db.insert(vfsRegistry).values({
          id: 'playlist-1',
          objectType: 'playlist',
          ownerId: null,
          createdAt: now
        });

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

        const insertedCount = await linkAudioToPlaylist(db, 'playlist-1', [
          'track-1'
        ]);
        expect(insertedCount).toBe(1);

        const trackRegistryRows = await db
          .select({ id: vfsRegistry.id, objectType: vfsRegistry.objectType })
          .from(vfsRegistry)
          .where(eq(vfsRegistry.id, 'track-1'));
        expect(trackRegistryRows).toHaveLength(1);
        expect(trackRegistryRows[0]?.objectType).toBe('file');

        const linksAfterFirstDrop = await db
          .select({ id: vfsLinks.id })
          .from(vfsLinks)
          .where(eq(vfsLinks.parentId, 'playlist-1'));
        expect(linksAfterFirstDrop).toHaveLength(1);

        const duplicateInsertedCount = await linkAudioToPlaylist(
          db,
          'playlist-1',
          ['track-1']
        );
        expect(duplicateInsertedCount).toBe(0);

        const linksAfterSecondDrop = await db
          .select({ id: vfsLinks.id })
          .from(vfsLinks)
          .where(eq(vfsLinks.parentId, 'playlist-1'));
        expect(linksAfterSecondDrop).toHaveLength(1);
      },
      { migrations }
    );
  });
});
