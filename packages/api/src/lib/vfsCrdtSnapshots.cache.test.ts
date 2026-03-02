import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadVfsCrdtRematerializationSnapshot } from './vfsCrdtSnapshots.js';

const redisStore = new Map<string, string>();
const mockRedisClient = {
  get: vi.fn((key: string) => Promise.resolve(redisStore.get(key) ?? null)),
  set: vi.fn((key: string, value: string) => {
    redisStore.set(key, value);
    return Promise.resolve('OK');
  }),
  del: vi.fn((key: string) => {
    redisStore.delete(key);
    return Promise.resolve(1);
  })
};

vi.mock('@tearleads/shared/redis', () => ({
  getRedisClient: () => Promise.resolve(mockRedisClient)
}));

const snapshotRow = {
  snapshot_payload: {
    replaySnapshot: {
      acl: [
        {
          itemId: 'item-visible',
          principalType: 'user',
          principalId: 'user-1',
          accessLevel: 'read'
        },
        {
          itemId: 'item-hidden',
          principalType: 'user',
          principalId: 'user-1',
          accessLevel: 'read'
        }
      ],
      links: [
        { parentId: 'root', childId: 'item-visible' },
        { parentId: 'root', childId: 'item-hidden' }
      ],
      cursor: {
        changedAt: '2026-02-24T12:00:00.000Z',
        changeId: 'crdt:500'
      }
    },
    containerClocks: [
      {
        containerId: 'item-visible',
        changedAt: '2026-02-24T12:00:00.000Z',
        changeId: 'crdt:500'
      },
      {
        containerId: 'item-hidden',
        changedAt: '2026-02-24T12:00:01.000Z',
        changeId: 'crdt:501'
      }
    ]
  },
  snapshot_cursor_changed_at: '2026-02-24T12:00:00.000Z',
  snapshot_cursor_change_id: 'crdt:500',
  updated_at: '2026-02-24T12:10:00.000Z'
};

describe('vfsCrdtSnapshots cache', () => {
  afterEach(() => {
    redisStore.clear();
  });

  it('reuses cached filtered snapshot for matching snapshotUpdatedAt', async () => {
    const firstQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [snapshotRow] })
      .mockResolvedValueOnce({ rows: [{ item_id: 'item-visible' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: '2026-02-24T11:00:00.000Z',
            last_reconciled_change_id: 'crdt:480',
            last_reconciled_write_ids: { desktop: 9, mobile: 1 }
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          { replica_id: 'desktop', max_write_id: '11' },
          { replica_id: 'mobile', max_write_id: '2' }
        ]
      });

    const secondQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [snapshotRow] })
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: '2026-02-24T11:00:00.000Z',
            last_reconciled_change_id: 'crdt:480',
            last_reconciled_write_ids: { desktop: 9, mobile: 1 }
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          { replica_id: 'desktop', max_write_id: '11' },
          { replica_id: 'mobile', max_write_id: '2' }
        ]
      });

    await loadVfsCrdtRematerializationSnapshot(
      { query: firstQuery },
      {
        userId: 'user-1',
        clientId: 'desktop'
      }
    );

    const snapshot = await loadVfsCrdtRematerializationSnapshot(
      { query: secondQuery },
      {
        userId: 'user-1',
        clientId: 'desktop'
      }
    );

    expect(snapshot?.replaySnapshot.acl).toHaveLength(1);
    expect(firstQuery).toHaveBeenCalledTimes(4);
    expect(secondQuery).toHaveBeenCalledTimes(2);
    expect(String(secondQuery.mock.calls[1]?.[0])).not.toContain(
      'FROM vfs_effective_visibility'
    );
  });
});
