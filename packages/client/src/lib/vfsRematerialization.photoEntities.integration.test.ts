import '../test/setupIntegration';

import { albums, files } from '@tearleads/db/sqlite';
import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase, resetDatabase, setupDatabase } from '@/db';
import {
  getFileStorageForInstance,
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

describe('vfsRematerialization photo entity rows', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRunLocalWrite.mockImplementation(
      async (callback: LocalWriteCallback): Promise<void> => callback()
    );
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
  });

  it('materializes album and photo entity tables from synced VFS data', async () => {
    const photoPayload = Buffer.from('<svg>logo</svg>', 'utf8').toString(
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
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await expect(rematerializeRemoteVfsStateIfNeeded()).resolves.toBe(true);

    const db = getDatabase();
    const albumRows = await db.select().from(albums);
    const fileRows = await db.select().from(files);

    expect(albumRows).toEqual([
      expect.objectContaining({
        id: 'album-item',
        encryptedName: 'Photos shared with Alice',
        albumType: 'custom'
      })
    ]);
    expect(fileRows).toEqual([
      expect.objectContaining({
        id: 'photo-item',
        name: 'Tearleads logo.svg',
        mimeType: 'image/svg+xml',
        deleted: false,
        storagePath: 'rematerialized-photo-item.enc'
      })
    ]);

    const rematerializedPhoto = fileRows[0];
    if (!rematerializedPhoto) {
      throw new Error('Expected rematerialized photo row');
    }
    expect(rematerializedPhoto.storagePath.includes('/')).toBe(false);
    expect(isFileStorageInitialized(TEST_INSTANCE_ID)).toBe(true);

    const storage = getFileStorageForInstance(TEST_INSTANCE_ID);
    const payloadBytes = await storage.retrieve(rematerializedPhoto.storagePath);
    expect(Buffer.from(payloadBytes).toString('utf8')).toBe('<svg>logo</svg>');
  });
});
