import '../test/setupIntegration';

import { vfsAclEntries } from '@tearleads/db/sqlite';
import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDatabase,
  getDatabaseAdapter,
  resetDatabase,
  setupDatabase
} from '@/db';
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

async function foreignKeysEnabled(): Promise<boolean> {
  const adapter = getDatabaseAdapter();
  const result = await adapter.execute('PRAGMA foreign_keys', []);
  const value = result.rows[0]?.foreign_keys;
  return value === 1 || value === '1' || value === true;
}

describe('vfsRematerialization grantor bootstrap integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRunLocalWrite.mockImplementation(
      async (callback: LocalWriteCallback): Promise<void> => callback()
    );
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
  });

  it('creates placeholder users for missing ACL grantors and keeps grantedBy', async () => {
    mockGetSync.mockResolvedValueOnce({
      items: [
        {
          changeId: 'change-missing-grantor-1',
          itemId: 'note-missing-grantor',
          changeType: 'upsert',
          changedAt: '2026-01-01T00:00:01.000Z',
          objectType: 'note',
          encryptedName: 'Missing grantor note',
          ownerId: 'user-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          accessLevel: 'admin'
        }
      ],
      nextCursor: null,
      hasMore: false
    });

    mockGetCrdtSync.mockResolvedValueOnce({
      items: [
        {
          opId: 'op-missing-grantor-1',
          itemId: 'note-missing-grantor',
          opType: 'acl_add',
          principalType: 'user',
          principalId: 'user-1',
          accessLevel: 'write',
          parentId: null,
          childId: null,
          actorId: 'user-not-present-locally',
          sourceTable: 'vfs_crdt_client_push',
          sourceId: 'source-missing-grantor-1',
          occurredAt: '2026-01-01T00:00:01.100Z'
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await expect(rematerializeRemoteVfsStateIfNeeded()).resolves.toBe(true);
    await expect(foreignKeysEnabled()).resolves.toBe(true);

    const db = getDatabase();
    const aclRows = await db.select().from(vfsAclEntries);
    expect(aclRows).toEqual([
      expect.objectContaining({
        id: 'source-missing-grantor-1',
        itemId: 'note-missing-grantor',
        principalType: 'user',
        principalId: 'user-1',
        accessLevel: 'write',
        grantedBy: 'user-not-present-locally'
      })
    ]);

    const adapter = getDatabaseAdapter();
    const grantorRows = await adapter.execute(
      `SELECT id, email FROM users WHERE id = ?`,
      ['user-not-present-locally']
    );
    expect(grantorRows.rows).toEqual([
      expect.objectContaining({
        id: 'user-not-present-locally',
        email: 'vfs-bootstrap+user-not-present-locally@tearleads.local'
      })
    ]);
  });
});
