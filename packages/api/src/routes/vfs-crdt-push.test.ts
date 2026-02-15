import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';
import { mockConsoleError } from '../test/console-mocks.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();
const mockClientRelease = vi.fn();
const mockPoolConnect = vi.fn().mockImplementation(() =>
  Promise.resolve({
    query: mockQuery,
    release: mockClientRelease
  })
);

vi.mock('../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
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

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => Promise.resolve(mockRedisClient)
}));

function buildValidPushPayload() {
  return {
    clientId: 'desktop',
    operations: [
      {
        opId: 'desktop-1',
        opType: 'acl_add',
        itemId: 'item-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T20:00:00.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      }
    ]
  };
}

function buildLinkPushPayload(overrides?: Record<string, unknown>) {
  return {
    clientId: 'desktop',
    operations: [
      {
        opId: 'desktop-link-1',
        opType: 'link_add',
        itemId: 'item-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T20:00:00.000Z',
        parentId: 'parent-1',
        ...overrides
      }
    ]
  };
}

describe('VFS CRDT push route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore.clear();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockPoolConnect.mockImplementation(() =>
      Promise.resolve({
        query: mockQuery,
        release: mockClientRelease
      })
    );
    mockGetPostgresPool.mockResolvedValue({
      connect: mockPoolConnect
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when not authenticated', async () => {
    const response = await request(app).post('/v1/vfs/crdt/push').send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when payload is invalid', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send({
        clientId: 'bad:client',
        operations: 'not-an-array'
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('clientId');
  });

  it('returns 400 when payload is not an object', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send('invalid-payload');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'clientId and operations are required'
    });
  });

  it('returns 400 when operations is not an array', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        operations: 'bad-shape'
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'operations must be an array' });
  });

  it('returns 400 when operation count exceeds limit', async () => {
    const authHeader = await createAuthHeader();
    const operations = Array.from({ length: 501 }, (_, index) => ({
      opId: `desktop-${index + 1}`,
      opType: 'acl_add',
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: index + 1,
      occurredAt: '2026-02-14T20:00:00.000Z',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read'
    }));

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        operations
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'operations exceeds max entries (500)'
    });
  });

  it('returns invalidOp for malformed operations and still commits', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        operations: [
          {
            opId: 'bad-op',
            opType: 'acl_add'
          }
        ]
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [
        {
          opId: 'bad-op',
          status: 'invalidOp'
        }
      ]
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0]?.[0]).toBe('BEGIN');
    expect(mockQuery.mock.calls[1]?.[0]).toBe('COMMIT');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('returns invalidOp for non-object operation entries', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        operations: [null]
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [
        {
          opId: 'invalid-0',
          status: 'invalidOp'
        }
      ]
    });
  });

  it('returns invalidOp for replica mismatch', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send({
        ...buildValidPushPayload(),
        operations: [
          {
            ...buildValidPushPayload().operations[0],
            replicaId: 'mobile'
          }
        ]
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'invalidOp' }]
    });
  });

  it('returns invalidOp for acl operation without valid principal', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send({
        ...buildValidPushPayload(),
        operations: [
          {
            ...buildValidPushPayload().operations[0],
            principalType: 'invalid-type'
          }
        ]
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'invalidOp' }]
    });
  });

  it('returns invalidOp for acl_add without valid access level', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send({
        ...buildValidPushPayload(),
        operations: [
          {
            ...buildValidPushPayload().operations[0],
            accessLevel: 'owner'
          }
        ]
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'invalidOp' }]
    });
  });

  it('returns invalidOp for link operation without parentId', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send(buildLinkPushPayload({ parentId: '   ' }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-link-1', status: 'invalidOp' }]
    });
  });

  it('returns invalidOp for link payload with childId mismatch', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send(buildLinkPushPayload({ childId: 'item-2' }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-link-1', status: 'invalidOp' }]
    });
  });

  it('returns invalidOp for self-referential link payloads', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send(buildLinkPushPayload({ parentId: 'item-1' }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-link-1', status: 'invalidOp' }]
    });
  });

  it('returns applied when operation insert succeeds', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: 0 }] }) // max write
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send(buildValidPushPayload());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'applied' }]
    });
    expect(mockQuery.mock.calls[3]?.[0]).toContain('WHERE source_table = $1');
    expect(mockQuery.mock.calls[4]?.[0]).toContain('MAX(occurred_at)');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('canonicalizes occurredAt when another replica already advanced actor feed time', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({
        rows: [
          {
            max_write_id: 0,
            max_occurred_at: new Date('2026-02-14T20:00:05.000Z')
          }
        ]
      }) // max write + max occurred_at
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send(buildValidPushPayload());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'applied' }]
    });
    expect(mockQuery.mock.calls[2]?.[1]?.[0]).toBe('vfs_crdt_feed:user-1');
    expect(mockQuery.mock.calls[5]?.[1]?.[10]).toBe('2026-02-14T20:00:05.001Z');
  });

  it('returns alreadyApplied when source id already exists', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [{ id: 'crdt-row-1' }] }) // existing source
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send(buildValidPushPayload());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'alreadyApplied' }]
    });
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('returns staleWriteId when replica write id is behind', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: 5 }] }) // max write
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send(buildValidPushPayload());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'staleWriteId' }]
    });
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('accepts numeric string max_write_id and applies higher writeId', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: '2' }] }) // max write (string)
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send({
        ...buildValidPushPayload(),
        operations: [
          {
            ...buildValidPushPayload().operations[0],
            writeId: 3
          }
        ]
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'applied' }]
    });
  });

  it('treats unparsable max_write_id as zero', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: 'nope' }] }) // max write (invalid string)
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send(buildValidPushPayload());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'applied' }]
    });
  });

  it('returns outdatedOp when insert affects zero rows', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: null }] }) // max write (null)
      .mockResolvedValueOnce({ rowCount: 0 }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send(buildValidPushPayload());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'outdatedOp' }]
    });
  });

  it('defaults link childId to itemId when childId is omitted', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing source
      .mockResolvedValueOnce({ rows: [{ max_write_id: 0 }] }) // max write
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send(buildLinkPushPayload({ childId: undefined }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-link-1', status: 'applied' }]
    });
    expect(mockQuery.mock.calls[5]?.[1]?.[6]).toBe('item-1');
  });

  it('returns invalidOp when item is missing or not owned', async () => {
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-2' }]
      }) // owner lookup
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send(buildValidPushPayload());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: 'desktop',
      results: [{ opId: 'desktop-1', status: 'invalidOp' }]
    });
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('rolls back and returns 500 on push processing error', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockRejectedValueOnce(new Error('lock failed')) // advisory lock
      .mockResolvedValueOnce({}); // ROLLBACK

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send(buildValidPushPayload());

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to push CRDT operations' });
    expect(mockQuery.mock.calls[3]?.[0]).toBe('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    restoreConsole();
  });

  it('still returns 500 when rollback fails', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      }) // owner lookup
      .mockRejectedValueOnce(new Error('lock failed')) // advisory lock
      .mockRejectedValueOnce(new Error('rollback failed')); // ROLLBACK

    const response = await request(app)
      .post('/v1/vfs/crdt/push')
      .set('Authorization', authHeader)
      .send(buildValidPushPayload());

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to push CRDT operations' });
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    restoreConsole();
  });
});
