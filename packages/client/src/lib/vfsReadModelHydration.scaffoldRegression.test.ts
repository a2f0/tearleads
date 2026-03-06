import '../test/setupIntegration';

import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabaseAdapter, resetDatabase, setupDatabase } from '@/db';
import { hydrateLocalReadModelFromRemoteFeeds } from './vfsReadModelHydration';

const mockGetSync = vi.fn();
const mockGetCrdtSync = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    vfs: {
      getSync: (...args: unknown[]) => mockGetSync(...args),
      getCrdtSync: (...args: unknown[]) => mockGetCrdtSync(...args)
    }
  }
}));

const TEST_PASSWORD = 'test-password-123';
const TEST_INSTANCE_ID = 'test-instance';

describe('vfsReadModelHydration scaffold regression', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
  });

  it('stores encrypted_name and materializes notes from feed payloads', async () => {
    const notePayload = Buffer.from('Hello, Alice', 'utf8').toString('base64');

    mockGetSync.mockResolvedValueOnce({
      items: [
        {
          changeId: 'sync-note-1',
          itemId: 'note-1',
          changeType: 'upsert',
          changedAt: '2026-03-01T00:00:01.000Z',
          objectType: 'note',
          ownerId: 'bob-id',
          createdAt: '2026-03-01T00:00:00.000Z',
          accessLevel: 'read',
          encryptedName: 'Note for Alice - From Bob'
        },
        {
          changeId: 'sync-folder-1',
          itemId: 'folder-1',
          changeType: 'upsert',
          changedAt: '2026-03-01T00:00:02.000Z',
          objectType: 'folder',
          ownerId: 'bob-id',
          createdAt: '2026-03-01T00:00:00.000Z',
          accessLevel: 'read',
          encryptedName: 'Notes shared with Alice'
        }
      ],
      nextCursor: null,
      hasMore: false
    });

    mockGetCrdtSync.mockResolvedValueOnce({
      items: [
        {
          opId: 'crdt-note-1',
          itemId: 'note-1',
          opType: 'item_upsert',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: null,
          childId: null,
          actorId: 'bob-id',
          sourceTable: 'vfs_item_state',
          sourceId: 'vfs-item-state-note-1',
          occurredAt: '2026-03-01T00:00:03.000Z',
          encryptedPayload: notePayload,
          keyEpoch: 1,
          encryptionNonce: null,
          encryptionAad: null,
          encryptionSignature: null
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await hydrateLocalReadModelFromRemoteFeeds();

    const adapter = getDatabaseAdapter();
    const registryRows = await adapter.execute(
      `SELECT id, encrypted_name FROM vfs_registry WHERE id IN (?, ?) ORDER BY id`,
      ['folder-1', 'note-1']
    );
    expect(registryRows.rows).toEqual([
      expect.objectContaining({
        id: 'folder-1',
        encrypted_name: 'Notes shared with Alice'
      }),
      expect.objectContaining({
        id: 'note-1',
        encrypted_name: 'Note for Alice - From Bob'
      })
    ]);

    const noteRows = await adapter.execute(
      `SELECT id, title, content, deleted FROM notes WHERE id = ?`,
      ['note-1']
    );
    expect(noteRows.rows).toEqual([
      expect.objectContaining({
        id: 'note-1',
        title: 'Note for Alice - From Bob',
        content: 'Hello, Alice',
        deleted: 0
      })
    ]);
  });

  it('hydrates scaffold link_add operations into vfs_links for root folder contents', async () => {
    mockGetSync.mockResolvedValueOnce({
      items: [
        {
          changeId: 'sync-root-1',
          itemId: '__vfs_root__',
          changeType: 'upsert',
          changedAt: '2026-03-01T00:00:00.000Z',
          objectType: 'folder',
          ownerId: null,
          createdAt: '2026-03-01T00:00:00.000Z',
          accessLevel: 'admin',
          encryptedName: 'VFS Root'
        },
        {
          changeId: 'sync-folder-1',
          itemId: 'folder-1',
          changeType: 'upsert',
          changedAt: '2026-03-01T00:00:01.000Z',
          objectType: 'folder',
          ownerId: 'bob-id',
          createdAt: '2026-03-01T00:00:01.000Z',
          accessLevel: 'admin',
          encryptedName: 'Notes shared with Alice'
        },
        {
          changeId: 'sync-note-1',
          itemId: 'note-1',
          changeType: 'upsert',
          changedAt: '2026-03-01T00:00:02.000Z',
          objectType: 'note',
          ownerId: 'bob-id',
          createdAt: '2026-03-01T00:00:02.000Z',
          accessLevel: 'admin',
          encryptedName: 'Note for Alice - From Bob'
        }
      ],
      nextCursor: null,
      hasMore: false
    });

    mockGetCrdtSync.mockResolvedValueOnce({
      items: [
        {
          opId: 'crdt-link-root-folder',
          itemId: 'folder-1',
          opType: 'link_add',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: '__vfs_root__',
          childId: 'folder-1',
          actorId: 'bob-id',
          sourceTable: 'vfs_links',
          sourceId: 'link-root-folder',
          occurredAt: '2026-03-01T00:00:03.000Z',
          encryptedPayload: null,
          keyEpoch: null,
          encryptionNonce: null,
          encryptionAad: null,
          encryptionSignature: null
        },
        {
          opId: 'crdt-link-folder-note',
          itemId: 'note-1',
          opType: 'link_add',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: 'folder-1',
          childId: 'note-1',
          actorId: 'bob-id',
          sourceTable: 'vfs_links',
          sourceId: 'link-folder-note',
          occurredAt: '2026-03-01T00:00:04.000Z',
          encryptedPayload: null,
          keyEpoch: null,
          encryptionNonce: null,
          encryptionAad: null,
          encryptionSignature: null
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await hydrateLocalReadModelFromRemoteFeeds();

    const adapter = getDatabaseAdapter();
    const rootChildrenRows = await adapter.execute(
      `SELECT parent_id, child_id
       FROM vfs_links
       WHERE parent_id = ?
       ORDER BY child_id`,
      ['__vfs_root__']
    );
    expect(rootChildrenRows.rows).toEqual([
      expect.objectContaining({
        parent_id: '__vfs_root__',
        child_id: 'folder-1'
      })
    ]);
  });
});
