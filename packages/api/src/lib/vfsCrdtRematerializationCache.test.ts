import { setTestEnv } from '../test/env.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readRematerializationSnapshotCache,
  writeRematerializationSnapshotCache
} from './vfsCrdtRematerializationCache.js';

const redisStore = new Map<string, string>();
const mockRedisClient = {
  get: vi.fn((key: string) => Promise.resolve(redisStore.get(key) ?? null)),
  set: vi.fn((key: string, value: string, _options?: { EX?: number }) => {
    redisStore.set(key, value);
    return Promise.resolve('OK');
  }),
  del: vi.fn((key: string) => {
    const existed = redisStore.delete(key);
    return Promise.resolve(existed ? 1 : 0);
  })
};

vi.mock('@tearleads/shared/redis', () => ({
  getRedisClient: () => Promise.resolve(mockRedisClient)
}));

function rematKey(
  scope: string,
  userId: string,
  clientId: string,
  snapshotUpdatedAt: string
): string {
  return `vfs:crdt:rematSnapshot:${encodeURIComponent(scope)}:${encodeURIComponent(userId)}:${encodeURIComponent(clientId)}:${encodeURIComponent(snapshotUpdatedAt)}`;
}

describe('vfsCrdtRematerializationCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();
  });

  it('writes and reads rematerialization snapshot cache entries', async () => {
    await writeRematerializationSnapshotCache({
      scope: 'global',
      userId: 'user-1',
      clientId: 'desktop',
      snapshotUpdatedAt: '2026-02-24T12:10:00.000Z',
      snapshot: {
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
      }
    });

    const cached = await readRematerializationSnapshotCache({
      scope: 'global',
      userId: 'user-1',
      clientId: 'desktop',
      snapshotUpdatedAt: '2026-02-24T12:10:00.000Z'
    });

    expect(cached).toEqual({
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
    });
    expect(mockRedisClient.set.mock.calls[0]?.[2]).toEqual({ EX: 30 });
  });

  it('returns undefined for malformed snapshot payloads', async () => {
    const key = rematKey(
      'global',
      'user-1',
      'desktop',
      '2026-02-24T12:10:00.000Z'
    );
    redisStore.set(key, '{bad-json');

    expect(
      await readRematerializationSnapshotCache({
        scope: 'global',
        userId: 'user-1',
        clientId: 'desktop',
        snapshotUpdatedAt: '2026-02-24T12:10:00.000Z'
      })
    ).toBeUndefined();

    redisStore.set(
      key,
      JSON.stringify({ replaySnapshot: { acl: 'bad' }, containerClocks: [] })
    );

    expect(
      await readRematerializationSnapshotCache({
        scope: 'global',
        userId: 'user-1',
        clientId: 'desktop',
        snapshotUpdatedAt: '2026-02-24T12:10:00.000Z'
      })
    ).toBeUndefined();
  });

  it('normalizes malformed nested entries while preserving valid ones', async () => {
    const key = rematKey(
      'global',
      'user-1',
      'desktop',
      '2026-02-24T12:10:00.000Z'
    );
    redisStore.set(
      key,
      JSON.stringify({
        replaySnapshot: {
          acl: [
            {
              itemId: 'item-1',
              principalType: 'user',
              principalId: 'user-1',
              accessLevel: 'read'
            },
            {
              itemId: '',
              principalType: 'invalid',
              principalId: '',
              accessLevel: 'none'
            }
          ],
          links: [
            { parentId: 'root', childId: 'item-1' },
            { parentId: '', childId: '' }
          ],
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
          },
          {
            containerId: '',
            changedAt: 'not-a-date',
            changeId: ''
          }
        ]
      })
    );

    const cached = await readRematerializationSnapshotCache({
      scope: 'global',
      userId: 'user-1',
      clientId: 'desktop',
      snapshotUpdatedAt: '2026-02-24T12:10:00.000Z'
    });

    expect(cached).toEqual({
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
    });
  });

  it('falls back gracefully when redis get fails', async () => {
    mockRedisClient.get.mockRejectedValueOnce(new Error('redis unavailable'));

    expect(
      await readRematerializationSnapshotCache({
        scope: 'global',
        userId: 'user-1',
        clientId: 'desktop',
        snapshotUpdatedAt: '2026-02-24T12:10:00.000Z'
      })
    ).toBeUndefined();
  });

  it('uses default TTL when rematerialization TTL env is invalid', async () => {
    setTestEnv('VFS_CRDT_REMAT_SNAPSHOT_CACHE_TTL_SECONDS', 'not-valid');

    await writeRematerializationSnapshotCache({
      scope: 'global',
      userId: 'user-1',
      clientId: 'desktop',
      snapshotUpdatedAt: '2026-02-24T12:10:00.000Z',
      snapshot: {
        replaySnapshot: {
          acl: [],
          links: [],
          cursor: null
        },
        containerClocks: []
      }
    });

    expect(mockRedisClient.set.mock.calls[0]?.[2]).toEqual({ EX: 30 });
  });
});
