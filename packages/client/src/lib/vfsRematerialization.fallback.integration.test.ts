import '../test/setupIntegration';

import { notes } from '@tearleads/db/sqlite';
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

describe('vfsRematerialization fallback mapping', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRunLocalWrite.mockImplementation(
      async (callback: LocalWriteCallback): Promise<void> => callback()
    );
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
  });

  it('falls back to untitled and empty body for blank/invalid values', async () => {
    mockGetSync.mockResolvedValueOnce({
      items: [
        {
          changeId: 'change-fallback-1',
          itemId: 'note-fallback-item',
          changeType: 'upsert',
          changedAt: '2026-01-04T00:00:01.000Z',
          objectType: 'note',
          encryptedName: '   ',
          ownerId: 'user-4',
          createdAt: '2026-01-04T00:00:01.000Z',
          accessLevel: 'admin'
        }
      ],
      nextCursor: null,
      hasMore: false
    });

    mockGetCrdtSync.mockResolvedValueOnce({
      items: [
        {
          opId: 'op-fallback-1',
          itemId: 'note-fallback-item',
          opType: 'item_upsert',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: null,
          childId: null,
          actorId: 'user-4',
          sourceTable: 'vfs_crdt_client_push',
          sourceId: 'source-fallback-1',
          occurredAt: '2026-01-04T00:00:01.100Z',
          encryptedPayload: '***',
          keyEpoch: 1
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await expect(rematerializeRemoteVfsStateIfNeeded()).resolves.toBe(true);

    const db = getDatabase();
    const noteRows = await db.select().from(notes);
    expect(noteRows).toEqual([
      expect.objectContaining({
        id: 'note-fallback-item',
        title: 'Untitled Note',
        content: ''
      })
    ]);
  });
});
