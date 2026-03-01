import '../test/setupIntegration';

import { vfsRegistry } from '@tearleads/db/sqlite';
import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase, resetDatabase, setupDatabase } from '@/db';
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

describe('vfsRematerialization root-only bootstrap', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRunLocalWrite.mockImplementation(
      async (callback: LocalWriteCallback): Promise<void> => callback()
    );
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
  });

  it('rematerializes when local registry only contains __vfs_root__', async () => {
    const db = getDatabase();
    await db.insert(vfsRegistry).values({
      id: '__vfs_root__',
      objectType: 'folder',
      ownerId: null,
      encryptedSessionKey: null,
      encryptedName: 'VFS Root',
      icon: null,
      viewMode: null,
      defaultSort: null,
      sortDirection: null,
      publicHierarchicalKey: null,
      encryptedPrivateHierarchicalKey: null,
      createdAt: new Date(0)
    });

    mockGetSync.mockResolvedValueOnce({
      items: [
        {
          changeId: 'change-root-only-1',
          itemId: 'remote-note-item',
          changeType: 'upsert',
          changedAt: '2026-01-03T00:00:01.000Z',
          objectType: 'note',
          encryptedName: 'Remote note',
          ownerId: 'user-root-only',
          createdAt: '2026-01-03T00:00:01.000Z',
          accessLevel: 'admin'
        }
      ],
      nextCursor: null,
      hasMore: false
    });

    mockGetCrdtSync.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await expect(rematerializeRemoteVfsStateIfNeeded()).resolves.toBe(true);
    expect(mockGetSync).toHaveBeenCalledTimes(1);

    const registryRows = await db.select().from(vfsRegistry);
    expect(registryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'remote-note-item',
          encryptedName: 'Remote note',
          objectType: 'note'
        })
      ])
    );
  });
});
