import {
  decodeVfsSyncCursor,
  encodeVfsSyncCursor
} from '@tearleads/vfs-sync/vfs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';

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
  getRedisClient: () => Promise.resolve(mockRedisClient)
}));

describe('VFS CRDT sync route', () => {
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
    const response = await request(app).get('/v1/vfs/crdt/vfs-sync');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when limit is invalid', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .get('/v1/vfs/crdt/vfs-sync?limit=0')
      .set('Authorization', authHeader);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('limit must be an integer');
  });

  it('returns 400 when cursor is invalid', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .get('/v1/vfs/crdt/vfs-sync?cursor=totally-invalid')
      .set('Authorization', authHeader);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid cursor' });
  });

  it('returns 409 when cursor is older than retained CRDT history', async () => {
    const authHeader = await createAuthHeader();
    const staleCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-10T00:00:00.000Z',
      changeId: 'op-10'
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          occurred_at: new Date('2026-02-14T00:00:00.000Z'),
          id: 'op-100'
        }
      ]
    });

    const response = await request(app)
      .get(
        `/v1/vfs/crdt/vfs-sync?limit=10&cursor=${encodeURIComponent(staleCursor)}`
      )
      .set('Authorization', authHeader);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error:
        'CRDT cursor is older than retained history; re-materialization required',
      code: 'crdt_rematerialization_required',
      requestedCursor: staleCursor,
      oldestAvailableCursor: encodeVfsSyncCursor({
        changedAt: '2026-02-14T00:00:00.000Z',
        changeId: 'op-100'
      })
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns a cursor-paginated CRDT operation page', async () => {
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          op_id: 'op-1',
          item_id: 'item-1',
          op_type: 'acl_add',
          principal_type: 'user',
          principal_id: 'user-2',
          access_level: 'write',
          parent_id: null,
          child_id: null,
          actor_id: 'user-1',
          source_table: 'vfs_crdt_client_push',
          source_id: 'share-1',
          occurred_at: new Date('2026-02-14T00:00:00.000Z')
        },
        {
          op_id: 'op-2',
          item_id: 'item-1',
          op_type: 'acl_remove',
          principal_type: 'user',
          principal_id: 'user-2',
          access_level: null,
          parent_id: null,
          child_id: null,
          actor_id: 'user-1',
          source_table: 'vfs_crdt_client_push',
          source_id: 'share-1',
          occurred_at: new Date('2026-02-14T00:00:01.000Z')
        }
      ]
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          replica_id: 'desktop',
          max_write_id: '7'
        },
        {
          replica_id: 'mobile',
          max_write_id: 3
        }
      ]
    });

    const response = await request(app)
      .get('/v1/vfs/crdt/vfs-sync?limit=1&rootId=root-123')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toEqual({
      opId: 'op-1',
      itemId: 'item-1',
      opType: 'acl_add',
      principalType: 'user',
      principalId: 'user-2',
      accessLevel: 'write',
      parentId: null,
      childId: null,
      actorId: 'user-1',
      sourceTable: 'vfs_crdt_client_push',
      sourceId: 'share-1',
      occurredAt: '2026-02-14T00:00:00.000Z'
    });
    expect(response.body.hasMore).toBe(true);
    expect(typeof response.body.nextCursor).toBe('string');
    expect(response.body.lastReconciledWriteIds).toEqual({
      desktop: 7,
      mobile: 3
    });
    expect(decodeVfsSyncCursor(response.body.nextCursor)).toEqual({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-1'
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([
      'user-1',
      null,
      null,
      2,
      'root-123'
    ]);
    expect(mockQuery.mock.calls[1]?.[1]).toEqual([
      'vfs_crdt_client_push',
      'user-1'
    ]);
  });

  it('returns encrypted envelope fields for encrypted CRDT operations', async () => {
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          op_id: 'op-enc-1',
          item_id: 'item-1',
          op_type: 'link_add',
          principal_type: null,
          principal_id: null,
          access_level: null,
          parent_id: null,
          child_id: null,
          actor_id: 'user-1',
          source_table: 'vfs_crdt_client_push',
          source_id: 'user-1:desktop:3:op-enc-1',
          occurred_at: new Date('2026-02-14T00:00:00.000Z'),
          encrypted_payload: 'base64-ciphertext',
          key_epoch: 3,
          encryption_nonce: 'base64-nonce',
          encryption_aad: 'base64-aad',
          encryption_signature: 'base64-signature'
        }
      ]
    });
    mockQuery.mockResolvedValueOnce({
      rows: []
    });

    const response = await request(app)
      .get('/v1/vfs/crdt/vfs-sync?limit=10')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      {
        opId: 'op-enc-1',
        itemId: 'item-1',
        opType: 'link_add',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: null,
        childId: null,
        actorId: 'user-1',
        sourceTable: 'vfs_crdt_client_push',
        sourceId: 'user-1:desktop:3:op-enc-1',
        occurredAt: '2026-02-14T00:00:00.000Z',
        encryptedPayload: 'base64-ciphertext',
        keyEpoch: 3,
        encryptionNonce: 'base64-nonce',
        encryptionAad: 'base64-aad',
        encryptionSignature: 'base64-signature'
      }
    ]);
  });

  it('normalizes unexpected CRDT enum values instead of crashing', async () => {
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          op_id: 'op-9',
          item_id: 'item-9',
          op_type: 'unknown-op',
          principal_type: 'unknown-principal',
          principal_id: 'user-9',
          access_level: 'unknown-access',
          parent_id: null,
          child_id: null,
          actor_id: 'user-1',
          source_table: 'vfs_crdt_client_push',
          source_id: 'share-9',
          occurred_at: new Date('2026-02-14T00:00:00.000Z')
        }
      ]
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          replica_id: 'desktop',
          max_write_id: '2'
        },
        {
          replica_id: '',
          max_write_id: '9'
        },
        {
          replica_id: 'broken',
          max_write_id: 'not-a-number'
        }
      ]
    });

    const response = await request(app)
      .get('/v1/vfs/crdt/vfs-sync?limit=10')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [
        {
          opId: 'op-9',
          itemId: 'item-9',
          opType: 'acl_add',
          principalType: null,
          principalId: 'user-9',
          accessLevel: null,
          parentId: null,
          childId: null,
          actorId: 'user-1',
          sourceTable: 'vfs_crdt_client_push',
          sourceId: 'share-9',
          occurredAt: '2026-02-14T00:00:00.000Z'
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {
        desktop: 2
      }
    });
  });

  it('returns 500 when CRDT rows violate ordering guardrails', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          op_id: 'op-2',
          item_id: 'item-1',
          op_type: 'acl_add',
          principal_type: 'user',
          principal_id: 'user-2',
          access_level: 'write',
          parent_id: null,
          child_id: null,
          actor_id: 'user-1',
          source_table: 'vfs_crdt_client_push',
          source_id: 'share-1',
          occurred_at: new Date('2026-02-14T00:00:01.000Z')
        },
        {
          op_id: 'op-1',
          item_id: 'item-1',
          op_type: 'acl_add',
          principal_type: 'user',
          principal_id: 'user-2',
          access_level: 'write',
          parent_id: null,
          child_id: null,
          actor_id: 'user-1',
          source_table: 'vfs_crdt_client_push',
          source_id: 'share-1',
          occurred_at: new Date('2026-02-14T00:00:00.000Z')
        }
      ]
    });

    const response = await request(app)
      .get('/v1/vfs/crdt/vfs-sync?limit=10')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to sync VFS CRDT operations'
    });
    restoreConsole();
  });

  it('returns 500 when CRDT rows contain duplicate op ids', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          op_id: 'op-1',
          item_id: 'item-1',
          op_type: 'acl_add',
          principal_type: 'user',
          principal_id: 'user-2',
          access_level: 'write',
          parent_id: null,
          child_id: null,
          actor_id: 'user-1',
          source_table: 'vfs_crdt_client_push',
          source_id: 'share-1',
          occurred_at: new Date('2026-02-14T00:00:00.000Z')
        },
        {
          op_id: 'op-1',
          item_id: 'item-2',
          op_type: 'acl_remove',
          principal_type: 'user',
          principal_id: 'user-3',
          access_level: null,
          parent_id: null,
          child_id: null,
          actor_id: 'user-1',
          source_table: 'vfs_crdt_client_push',
          source_id: 'share-2',
          occurred_at: new Date('2026-02-14T00:00:01.000Z')
        }
      ]
    });

    const response = await request(app)
      .get('/v1/vfs/crdt/vfs-sync')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to sync VFS CRDT operations'
    });
    restoreConsole();
  });

  it('returns 500 when CRDT rows contain malformed link payloads', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            op_id: 'op-link-1',
            item_id: 'item-1',
            op_type: 'link_add',
            principal_type: null,
            principal_id: null,
            access_level: null,
            parent_id: 'parent-1',
            child_id: 'item-2',
            actor_id: 'user-1',
            source_table: 'vfs_crdt_client_push',
            source_id: 'user-1:desktop:1:op-link-1',
            occurred_at: new Date('2026-02-14T00:00:01.000Z')
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    const response = await request(app)
      .get('/v1/vfs/crdt/vfs-sync?limit=10')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to sync VFS CRDT operations'
    });
    restoreConsole();
  });

  it('returns 500 when database query fails', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    mockQuery.mockRejectedValueOnce(new Error('Database failure'));

    const response = await request(app)
      .get('/v1/vfs/crdt/vfs-sync')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to sync VFS CRDT operations'
    });
    restoreConsole();
  });

  it('returns 500 when replica write-id query fails', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({
        rows: []
      })
      .mockRejectedValueOnce(new Error('Replica write-id query failed'));

    const response = await request(app)
      .get('/v1/vfs/crdt/vfs-sync')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to sync VFS CRDT operations'
    });
    restoreConsole();
  });
});
