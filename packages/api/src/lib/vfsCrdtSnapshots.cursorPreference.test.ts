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

describe('vfsCrdtSnapshots cursor preference', () => {
  afterEach(() => {
    redisStore.clear();
  });

  it('prefers newer snapshot column cursor over payload cursor', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            snapshot_payload: JSON.stringify({
              replaySnapshot: {
                acl: [
                  {
                    itemId: 'item-1',
                    principalType: 'user',
                    principalId: 'user-1',
                    accessLevel: 'read'
                  }
                ],
                links: [{ parentId: 'root', childId: 'item-1' }],
                cursor: {
                  changedAt: '2026-02-24T12:00:00.000Z',
                  changeId: 'crdt:500'
                }
              },
              containerClocks: [
                {
                  containerId: 'item-1',
                  changedAt: '2026-02-24T12:00:00.000Z',
                  changeId: 'crdt:500'
                }
              ]
            }),
            snapshot_cursor_changed_at: '2026-02-24T12:10:00.000Z',
            snapshot_cursor_change_id: 'crdt:900',
            updated_at: '2026-02-24T12:11:00.000Z'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ item_id: 'item-1' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: '2026-02-24T11:00:00.000Z',
            last_reconciled_change_id: 'crdt:400',
            last_reconciled_write_ids: {}
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ replica_id: 'desktop', max_write_id: '4' }]
      });

    const snapshot = await loadVfsCrdtRematerializationSnapshot(
      { query },
      {
        userId: 'user-1',
        clientId: 'desktop'
      }
    );

    expect(snapshot).toEqual({
      replaySnapshot: {
        acl: [
          {
            itemId: 'item-1',
            principalType: 'user',
            principalId: 'user-1',
            accessLevel: 'read'
          }
        ],
        links: [{ parentId: 'root', childId: 'item-1' }],
        cursor: {
          changedAt: '2026-02-24T12:10:00.000Z',
          changeId: 'crdt:900'
        }
      },
      reconcileState: {
        cursor: {
          changedAt: '2026-02-24T12:10:00.000Z',
          changeId: 'crdt:900'
        },
        lastReconciledWriteIds: {
          desktop: 4
        }
      },
      containerClocks: [
        {
          containerId: 'item-1',
          changedAt: '2026-02-24T12:00:00.000Z',
          changeId: 'crdt:500'
        }
      ],
      snapshotUpdatedAt: '2026-02-24T12:11:00.000Z'
    });
    expect(query).toHaveBeenCalledTimes(4);
  });
});
