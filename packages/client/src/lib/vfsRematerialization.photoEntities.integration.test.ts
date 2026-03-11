import '../test/setupIntegration';

import { albums, files, playlists, vfsLinks } from '@tearleads/db/sqlite';
import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase, resetDatabase, setupDatabase } from '@/db';
import {
  getFileStorage,
  getFileStorageForInstance,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import { rematerializeRemoteVfsStateIfNeeded } from './vfsRematerialization';

type LocalWriteCallback = () => Promise<void>;

const mockGetSync = vi.fn();
const mockGetCrdtSync = vi.fn();
const mockRunLocalWrite = vi.fn(
  async (callback: LocalWriteCallback): Promise<void> => callback()
);

vi.mock('@/lib/api', () => ({
  api: {
    vfs: {
      getSync: (...args: unknown[]) => mockGetSync(...args),
      getCrdtSync: (...args: unknown[]) => mockGetCrdtSync(...args)
    }
  }
}));
vi.mock('@/db/localWrite', () => ({
  runLocalWrite: (callback: LocalWriteCallback) => mockRunLocalWrite(callback)
}));

const TEST_PASSWORD = 'test-password-123';
const TEST_INSTANCE_ID = 'test-instance';

describe('vfsRematerialization media entity rows', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRunLocalWrite.mockImplementation(
      async (callback: LocalWriteCallback): Promise<void> => callback()
    );
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
  });

  it('materializes playlist/audio and album/photo rows and memberships from synced VFS data', async () => {
    const photoPayload = Buffer.from('<svg>logo</svg>', 'utf8').toString(
      'base64'
    );
    const audioPayload = Buffer.from('ID3-test-track', 'utf8').toString(
      'base64'
    );

    mockGetSync.mockResolvedValueOnce({
      items: [
        {
          changeId: 'change-root',
          itemId: 'root-item',
          changeType: 'upsert',
          changedAt: '2026-01-01T02:00:01.000Z',
          objectType: 'folder',
          encryptedName: 'Root Item',
          ownerId: 'user-1',
          createdAt: '2026-01-01T02:00:00.000Z',
          accessLevel: 'admin'
        },
        {
          changeId: 'change-album',
          itemId: 'album-item',
          changeType: 'upsert',
          changedAt: '2026-01-01T02:00:02.000Z',
          objectType: 'album',
          encryptedName: 'Photos shared with Alice',
          ownerId: 'user-1',
          createdAt: '2026-01-01T02:00:02.000Z',
          accessLevel: 'admin'
        },
        {
          changeId: 'change-photo',
          itemId: 'photo-item',
          changeType: 'upsert',
          changedAt: '2026-01-01T02:00:03.000Z',
          objectType: 'photo',
          encryptedName: 'Tearleads logo.svg',
          ownerId: 'user-1',
          createdAt: '2026-01-01T02:00:03.000Z',
          accessLevel: 'admin'
        },
        {
          changeId: 'change-playlist',
          itemId: 'playlist-item',
          changeType: 'upsert',
          changedAt: '2026-01-01T02:00:04.000Z',
          objectType: 'playlist',
          encryptedName: 'Music shared with Alice',
          ownerId: 'user-1',
          createdAt: '2026-01-01T02:00:04.000Z',
          accessLevel: 'admin'
        },
        {
          changeId: 'change-audio',
          itemId: 'audio-item',
          changeType: 'upsert',
          changedAt: '2026-01-01T02:00:05.000Z',
          objectType: 'audio',
          encryptedName: 'The Blessing.mp3',
          ownerId: 'user-1',
          createdAt: '2026-01-01T02:00:05.000Z',
          accessLevel: 'admin'
        }
      ],
      nextCursor: null,
      hasMore: false
    });

    mockGetCrdtSync.mockResolvedValueOnce({
      items: [
        {
          opId: 'op-photo-state',
          itemId: 'photo-item',
          opType: 'item_upsert',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: null,
          childId: null,
          actorId: 'user-1',
          sourceTable: 'vfs_crdt_client_push',
          sourceId: 'source-photo-state',
          occurredAt: '2026-01-01T02:00:03.100Z',
          encryptedPayload: photoPayload,
          keyEpoch: 1
        },
        {
          opId: 'op-root-album-link',
          itemId: 'album-item',
          opType: 'link_add',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: 'root-item',
          childId: 'album-item',
          actorId: 'user-1',
          sourceTable: 'vfs_links',
          sourceId: 'source-root-album-link',
          occurredAt: '2026-01-01T02:00:03.200Z'
        },
        {
          opId: 'op-album-photo-link',
          itemId: 'photo-item',
          opType: 'link_add',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: 'album-item',
          childId: 'photo-item',
          actorId: 'user-1',
          sourceTable: 'vfs_links',
          sourceId: 'source-album-photo-link',
          occurredAt: '2026-01-01T02:00:03.300Z'
        },
        {
          opId: 'op-audio-state',
          itemId: 'audio-item',
          opType: 'item_upsert',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: null,
          childId: null,
          actorId: 'user-1',
          sourceTable: 'vfs_crdt_client_push',
          sourceId: 'source-audio-state',
          occurredAt: '2026-01-01T02:00:05.100Z',
          encryptedPayload: audioPayload,
          keyEpoch: 1
        },
        {
          opId: 'op-root-playlist-link',
          itemId: 'playlist-item',
          opType: 'link_add',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: 'root-item',
          childId: 'playlist-item',
          actorId: 'user-1',
          sourceTable: 'vfs_links',
          sourceId: 'source-root-playlist-link',
          occurredAt: '2026-01-01T02:00:05.200Z'
        },
        {
          opId: 'op-playlist-audio-link',
          itemId: 'audio-item',
          opType: 'link_add',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: 'playlist-item',
          childId: 'audio-item',
          actorId: 'user-1',
          sourceTable: 'vfs_links',
          sourceId: 'source-playlist-audio-link',
          occurredAt: '2026-01-01T02:00:05.300Z'
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await expect(rematerializeRemoteVfsStateIfNeeded()).resolves.toBe(true);

    const db = getDatabase();
    const albumRows = await db.select().from(albums);
    const playlistRows = await db.select().from(playlists);
    const fileRows = await db.select().from(files);
    const linkRows = await db.select().from(vfsLinks);

    expect(albumRows).toEqual([
      expect.objectContaining({
        id: 'album-item',
        encryptedName: 'Photos shared with Alice',
        albumType: 'custom'
      })
    ]);
    expect(playlistRows).toEqual([
      expect.objectContaining({
        id: 'playlist-item',
        encryptedName: 'Music shared with Alice',
        mediaType: 'audio',
        shuffleMode: 0
      })
    ]);
    expect(fileRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'audio-item',
          name: 'The Blessing.mp3',
          mimeType: 'audio/mpeg',
          deleted: false,
          storagePath: 'rematerialized-audio-item.enc'
        }),
        expect.objectContaining({
          id: 'photo-item',
          name: 'Tearleads logo.svg',
          mimeType: 'image/svg+xml',
          deleted: false,
          storagePath: 'rematerialized-photo-item.enc'
        })
      ])
    );
    expect(linkRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'link:root-item:album-item',
          parentId: 'root-item',
          childId: 'album-item'
        }),
        expect.objectContaining({
          id: 'link:album-item:photo-item',
          parentId: 'album-item',
          childId: 'photo-item'
        }),
        expect.objectContaining({
          id: 'link:root-item:playlist-item',
          parentId: 'root-item',
          childId: 'playlist-item'
        }),
        expect.objectContaining({
          id: 'link:playlist-item:audio-item',
          parentId: 'playlist-item',
          childId: 'audio-item'
        })
      ])
    );

    const fileRowsById = new Map(fileRows.map((row) => [row.id, row]));
    const rematerializedPhoto = fileRowsById.get('photo-item');
    const rematerializedAudio = fileRowsById.get('audio-item');
    if (!rematerializedPhoto || !rematerializedAudio) {
      throw new Error('Expected rematerialized audio and photo rows');
    }
    expect(rematerializedPhoto.storagePath.includes('/')).toBe(false);
    expect(rematerializedAudio.storagePath.includes('/')).toBe(false);
    expect(isFileStorageInitialized(TEST_INSTANCE_ID)).toBe(true);

    const storage = getFileStorageForInstance(TEST_INSTANCE_ID);
    const photoPayloadBytes = await storage.retrieve(
      rematerializedPhoto.storagePath
    );
    expect(Buffer.from(photoPayloadBytes).toString('utf8')).toBe(
      '<svg>logo</svg>'
    );
    const audioPayloadBytes = await storage.retrieve(
      rematerializedAudio.storagePath
    );
    expect(Buffer.from(audioPayloadBytes).toString('utf8')).toBe(
      'ID3-test-track'
    );

    // Regression guard: a later instance initialization must not break
    // retrieval for already-rematerialized media in this instance.
    await initializeFileStorage(new Uint8Array(32), 'other-instance');
    const instanceScopedStorage = getFileStorage(TEST_INSTANCE_ID);
    const photoBytesAfterOtherInit = await instanceScopedStorage.retrieve(
      rematerializedPhoto.storagePath
    );
    expect(Buffer.from(photoBytesAfterOtherInit).toString('utf8')).toBe(
      '<svg>logo</svg>'
    );
  });
});
