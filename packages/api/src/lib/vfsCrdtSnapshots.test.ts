import { describe, expect, it, vi } from 'vitest';
import {
  loadVfsCrdtRematerializationSnapshot,
  refreshVfsCrdtSnapshot
} from './vfsCrdtSnapshots.js';

describe('vfsCrdtSnapshots', () => {
  it('refreshes and upserts deterministic snapshot payload', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            occurred_at: '2026-02-24T12:00:00.000Z',
            id: 'crdt:500'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            item_id: 'item-1',
            principal_type: 'user',
            principal_id: 'user-1',
            access_level: 'admin'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            parent_id: 'root',
            child_id: 'item-1'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            container_id: 'item-1',
            changed_at: '2026-02-24T12:00:00.000Z',
            change_id: 'crdt:500'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            updated_at: '2026-02-24T12:01:00.000Z'
          }
        ]
      });

    const result = await refreshVfsCrdtSnapshot({ query });

    expect(result).toEqual({
      scope: 'global',
      updatedAt: '2026-02-24T12:01:00.000Z',
      cursor: {
        changedAt: '2026-02-24T12:00:00.000Z',
        changeId: 'crdt:500'
      },
      aclEntries: 1,
      links: 1,
      containerClocks: 1
    });
    expect(query).toHaveBeenCalledTimes(5);
    expect(String(query.mock.calls[4]?.[0])).toContain(
      'INSERT INTO vfs_crdt_snapshots'
    );
    expect(query.mock.calls[4]?.[1]).toEqual([
      'global',
      expect.any(String),
      '2026-02-24T12:00:00.000Z',
      'crdt:500'
    ]);
  });

  it('loads rematerialization snapshot filtered to visible items', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
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
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ item_id: 'item-visible' }]
      })
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
            itemId: 'item-visible',
            principalType: 'user',
            principalId: 'user-1',
            accessLevel: 'read'
          }
        ],
        links: [{ parentId: 'root', childId: 'item-visible' }],
        cursor: {
          changedAt: '2026-02-24T12:00:00.000Z',
          changeId: 'crdt:500'
        }
      },
      reconcileState: {
        cursor: {
          changedAt: '2026-02-24T12:00:00.000Z',
          changeId: 'crdt:500'
        },
        lastReconciledWriteIds: {
          desktop: 11,
          mobile: 2
        }
      },
      containerClocks: [
        {
          containerId: 'item-visible',
          changedAt: '2026-02-24T12:00:00.000Z',
          changeId: 'crdt:500'
        }
      ],
      snapshotUpdatedAt: '2026-02-24T12:10:00.000Z'
    });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('returns null when no persisted snapshot is available', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });

    const snapshot = await loadVfsCrdtRematerializationSnapshot(
      { query },
      {
        userId: 'user-1',
        clientId: 'desktop'
      }
    );

    expect(snapshot).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
