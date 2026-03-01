import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool()
}));

const sessionStore = new Map<string, string>();
const mockRedisClient = {
  get: vi.fn((key: string) => Promise.resolve(sessionStore.get(key) ?? null)),
  set: vi.fn((key: string, value: string) => {
    sessionStore.set(key, value);
    return Promise.resolve('OK');
  }),
  del: vi.fn((key: string) => {
    sessionStore.delete(key);
    return Promise.resolve(1);
  }),
  sAdd: vi.fn(() => Promise.resolve(1)),
  sRem: vi.fn(() => Promise.resolve(1)),
  expire: vi.fn(() => Promise.resolve(1))
};

vi.mock('@tearleads/shared/redis', () => ({
  getRedisClient: () => Promise.resolve(mockRedisClient),
  getRedisSubscriberOverride: () => mockRedisClient,
  setRedisSubscriberOverrideForTesting: vi.fn()
}));

describe('VFS CRDT snapshot route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore.clear();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when not authenticated', async () => {
    const response = await request(app).get(
      '/v1/vfs/crdt/snapshot?clientId=desktop'
    );
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when clientId is invalid', async () => {
    const authHeader = await createAuthHeader();
    const response = await request(app)
      .get('/v1/vfs/crdt/snapshot?clientId=bad%3Aclient')
      .set('Authorization', authHeader);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('clientId must be non-empty');
  });

  it('returns 404 when no persisted snapshot exists', async () => {
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: []
    });

    const response = await request(app)
      .get('/v1/vfs/crdt/snapshot?clientId=desktop')
      .set('Authorization', authHeader);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'No CRDT snapshot is available' });
  });

  it('returns rematerialization snapshot for authenticated client', async () => {
    const authHeader = await createAuthHeader();

    mockQuery
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
                  }
                ],
                links: [{ parentId: 'root', childId: 'item-visible' }],
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
            last_reconciled_write_ids: { desktop: 2 }
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ replica_id: 'desktop', max_write_id: '3' }]
      });

    const response = await request(app)
      .get('/v1/vfs/crdt/snapshot?clientId=desktop')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
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
          desktop: 3
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
  });
});
