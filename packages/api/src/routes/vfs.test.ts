import { encodeVfsSyncCursor } from '@tearleads/sync/vfs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';
import { mockConsoleError } from '../test/consoleMocks.js';

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

// Mock Redis for session storage
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

describe('VFS routes', () => {
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
      query: mockQuery,
      connect: mockPoolConnect
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('GET /vfs/keys/me', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app).get('/v1/vfs/keys/me');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 404 when user has no VFS keys', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/v1/vfs/keys/me')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'VFS keys not set up' });
    });

    it('returns 200 with public keys when user has VFS keys', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            public_encryption_key: 'enc-key-123',
            public_signing_key: 'sign-key-456',
            encrypted_private_keys: 'encrypted-blob',
            argon2_salt: 'argon2-salt'
          }
        ]
      });

      const response = await request(app)
        .get('/v1/vfs/keys/me')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        publicEncryptionKey: 'enc-key-123',
        publicSigningKey: 'sign-key-456',
        encryptedPrivateKeys: 'encrypted-blob',
        argon2Salt: 'argon2-salt'
      });
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/v1/vfs/keys/me')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get VFS keys' });
      restoreConsole();
    });
  });

  describe('POST /vfs/keys', () => {
    const validPayload = {
      publicEncryptionKey: 'enc-key',
      publicSigningKey: 'sign-key',
      encryptedPrivateKeys: 'encrypted-blob',
      argon2Salt: 'salt-value'
    };

    it('returns 401 when not authenticated', async () => {
      const response = await request(app)
        .post('/v1/vfs/keys')
        .send(validPayload);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 when payload is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/keys')
        .set('Authorization', authHeader)
        .send({ publicEncryptionKey: 'only-one-key' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });

    it('returns 400 when payload has empty strings', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/keys')
        .set('Authorization', authHeader)
        .send({
          publicEncryptionKey: '   ',
          publicSigningKey: 'sign-key',
          encryptedPrivateKeys: 'blob',
          argon2Salt: 'salt'
        });

      expect(response.status).toBe(400);
    });

    it('returns 409 when keys already exist', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // existing keys

      const response = await request(app)
        .post('/v1/vfs/keys')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'VFS keys already exist for this user'
      });
    });

    it('returns 201 when keys are created successfully', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [] }); // no existing keys
      mockQuery.mockResolvedValueOnce({ rows: [] }); // insert

      const response = await request(app)
        .post('/v1/vfs/keys')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ created: true });
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .post('/v1/vfs/keys')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to set up VFS keys' });
      restoreConsole();
    });
  });

  describe('POST /vfs/register', () => {
    const validPayload = {
      id: 'file-uuid-123',
      objectType: 'file',
      encryptedSessionKey: 'encrypted-key-blob'
    };

    it('returns 401 when not authenticated', async () => {
      const response = await request(app)
        .post('/v1/vfs/register')
        .send(validPayload);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 when payload is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/register')
        .set('Authorization', authHeader)
        .send({ id: 'file-id' }); // missing objectType and encryptedSessionKey

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });

    it('returns 400 when objectType is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/register')
        .set('Authorization', authHeader)
        .send({
          id: 'file-id',
          objectType: 'invalid-type',
          encryptedSessionKey: 'blob'
        });

      expect(response.status).toBe(400);
    });

    it('returns 409 when item already registered', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // existing item

      const response = await request(app)
        .post('/v1/vfs/register')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Item already registered in VFS'
      });
    });

    it('returns 201 when item is registered successfully', async () => {
      const authHeader = await createAuthHeader();
      const createdAt = new Date('2024-01-15T12:00:00Z');
      mockQuery.mockResolvedValueOnce({ rows: [] }); // no existing item
      mockQuery.mockResolvedValueOnce({ rows: [{ created_at: createdAt }] }); // insert

      const response = await request(app)
        .post('/v1/vfs/register')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: 'file-uuid-123',
        createdAt: '2024-01-15T12:00:00.000Z'
      });
    });

    it('accepts all valid object types', async () => {
      const objectTypes = ['file', 'folder', 'contact', 'note', 'photo'];
      const createdAt = new Date();

      for (const objectType of objectTypes) {
        const authHeader = await createAuthHeader();
        mockQuery.mockResolvedValueOnce({ rows: [] }); // no existing item
        mockQuery.mockResolvedValueOnce({ rows: [{ created_at: createdAt }] }); // insert

        const response = await request(app)
          .post('/v1/vfs/register')
          .set('Authorization', authHeader)
          .send({
            id: `item-${objectType}`,
            objectType,
            encryptedSessionKey: 'blob'
          });

        expect(response.status).toBe(201);
      }
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .post('/v1/vfs/register')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to register VFS item' });
      restoreConsole();
    });
  });

  describe('POST /vfs/blobs/stage', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app).post('/v1/vfs/blobs/stage').send({});

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 when payload is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({ blobId: 'blob-1' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'blobId and expiresAt are required'
      });
    });

    it('returns 400 when expiresAt is in the past', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          blobId: 'blob-1',
          expiresAt: '2020-01-01T00:00:00.000Z'
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'expiresAt must be in the future' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 201 when blob staging is created', async () => {
      const authHeader = await createAuthHeader();
      const stagedAt = new Date('2026-02-14T10:00:00.000Z');
      const expiresAt = new Date('2026-02-14T11:00:00.000Z');
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({}) // INSERT staging registry row
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              status: 'staged',
              staged_at: stagedAt,
              expires_at: expiresAt
            }
          ]
        }) // INSERT staging link row
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          stagingId: 'stage-1',
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z'
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        stagingId: 'stage-1',
        blobId: 'blob-1',
        status: 'staged',
        stagedAt: '2026-02-14T10:00:00.000Z',
        expiresAt: '2026-02-14T11:00:00.000Z'
      });
    });

    it('normalizes string timestamps returned from database', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({}) // INSERT staging registry row
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-2',
              blob_id: 'blob-2',
              status: 'staged',
              staged_at: '2026-02-14T10:00:00.000Z',
              expires_at: '2026-02-14T11:00:00.000Z'
            }
          ]
        }) // INSERT staging link row
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          stagingId: 'stage-2',
          blobId: 'blob-2',
          expiresAt: '2099-02-14T11:00:00.000Z'
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        stagingId: 'stage-2',
        blobId: 'blob-2',
        status: 'staged',
        stagedAt: '2026-02-14T10:00:00.000Z',
        expiresAt: '2026-02-14T11:00:00.000Z'
      });
    });

    it('returns 500 when insert returns no row', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({}) // INSERT staging registry row
        .mockResolvedValueOnce({ rows: [] }) // INSERT staging link row
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z'
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to stage blob' });
      restoreConsole();
    });

    it('returns 404 when blob object does not exist', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT blob registry row
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          blobId: 'blob-missing',
          expiresAt: '2099-02-14T11:00:00.000Z'
        });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Blob object not found' });
    });

    it('returns 409 when staging id already exists', async () => {
      const authHeader = await createAuthHeader();
      const conflictError = Object.assign(new Error('duplicate'), {
        code: '23505'
      });
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockRejectedValueOnce(conflictError) // INSERT stage registry
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          stagingId: 'stage-1',
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z'
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Blob staging already exists' });
    });

    it('returns 500 on unexpected stage error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockRejectedValueOnce(new Error('db unavailable')) // INSERT stage registry
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z'
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to stage blob' });
      restoreConsole();
    });

    it('returns 409 when blob id resolves to a non-blob object', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ object_type: 'note' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage')
        .set('Authorization', authHeader)
        .send({
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z'
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob object id conflicts with existing VFS object'
      });
    });
  });

  describe('POST /vfs/blobs/stage/:stagingId/attach', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 404 when staged blob is missing', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT ... FOR UPDATE
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Blob staging not found' });
      expect(mockQuery.mock.calls[1]?.[0]).toContain('FOR UPDATE');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when itemId is missing', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'itemId is required' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 200 when attach succeeds with transaction ordering guardrails', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT ... FOR UPDATE
        .mockResolvedValueOnce({
          rows: [
            {
              blob_id: 'blob-1',
              attached_at: '2026-02-14T10:10:00.000Z',
              attached_item_id: 'item-1'
            }
          ]
        }) // UPDATE
        .mockResolvedValueOnce({
          rowCount: 1
        }) // UPSERT blob into vfs_registry
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({
          rows: [{ id: 'ref-1', created_at: '2026-02-14T10:10:00.000Z' }]
        }) // INSERT blob link
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1', relationKind: 'file' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        attached: true,
        stagingId: 'stage-1',
        blobId: 'blob-1',
        itemId: 'item-1',
        relationKind: 'file',
        refId: 'ref-1',
        attachedAt: '2026-02-14T10:10:00.000Z'
      });
      expect(mockQuery.mock.calls[0]?.[0]).toBe('BEGIN');
      expect(mockQuery.mock.calls[1]?.[0]).toContain('FOR UPDATE');
      expect(mockQuery.mock.calls[2]?.[0]).toContain(
        "wrapped_session_key = 'blob-stage:staged'"
      );
      expect(mockQuery.mock.calls[5]?.[0]).toContain('INSERT INTO vfs_links');
      expect(mockQuery.mock.calls[6]?.[0]).toBe('COMMIT');
      expect(mockPoolConnect).toHaveBeenCalledTimes(1);
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('falls back to existing blob link when insert conflicts', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT ... FOR UPDATE (staging)
        .mockResolvedValueOnce({
          rows: [
            {
              blob_id: 'blob-1',
              attached_at: '2026-02-14T10:10:00.000Z',
              attached_item_id: 'item-1'
            }
          ]
        }) // UPDATE
        .mockResolvedValueOnce({
          rowCount: 1
        }) // UPSERT blob into vfs_registry
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({ rows: [] }) // INSERT ref conflict
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'existing-ref-1',
              created_at: '2026-02-14T10:10:01.000Z',
              wrapped_session_key: 'blob-link:file',
              visible_children: {
                relationKind: 'file',
                attachedBy: 'user-1'
              }
            }
          ]
        }) // SELECT existing ref
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1', relationKind: 'file' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        attached: true,
        stagingId: 'stage-1',
        blobId: 'blob-1',
        itemId: 'item-1',
        relationKind: 'file',
        refId: 'existing-ref-1',
        attachedAt: '2026-02-14T10:10:01.000Z'
      });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 200 when reconcile visibility guardrails are satisfied', async () => {
      const authHeader = await createAuthHeader();
      const requiredCursor = encodeVfsSyncCursor({
        changedAt: '2026-02-14T10:00:02.000Z',
        changeId: 'desktop-2'
      });

      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT ... FOR UPDATE (staging)
        .mockResolvedValueOnce({
          rows: [
            {
              last_reconciled_at: '2026-02-14T10:00:03.000Z',
              last_reconciled_change_id: 'desktop-3',
              last_reconciled_write_ids: {
                desktop: 3,
                mobile: 1
              }
            }
          ]
        }) // SELECT ... FOR UPDATE (reconcile)
        .mockResolvedValueOnce({
          rows: [
            {
              blob_id: 'blob-1',
              attached_at: '2026-02-14T10:10:00.000Z',
              attached_item_id: 'item-1'
            }
          ]
        }) // UPDATE
        .mockResolvedValueOnce({
          rowCount: 1
        }) // UPSERT blob into vfs_registry
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({
          rows: [{ id: 'ref-1', created_at: '2026-02-14T10:10:00.000Z' }]
        }) // INSERT blob link
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-1',
          relationKind: 'file',
          clientId: 'desktop',
          requiredCursor,
          requiredLastReconciledWriteIds: {
            desktop: 2
          }
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        attached: true,
        stagingId: 'stage-1',
        blobId: 'blob-1',
        itemId: 'item-1',
        relationKind: 'file',
        refId: 'ref-1',
        attachedAt: '2026-02-14T10:10:00.000Z'
      });
      expect(mockQuery.mock.calls[2]?.[0]).toContain(
        'FROM vfs_sync_client_state'
      );
      expect(mockQuery.mock.calls[2]?.[1]).toEqual(['user-1', 'crdt:desktop']);
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when guardrails are provided without clientId', async () => {
      const authHeader = await createAuthHeader();
      const requiredCursor = encodeVfsSyncCursor({
        changedAt: '2026-02-14T10:00:02.000Z',
        changeId: 'desktop-2'
      });

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-1',
          requiredCursor
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'clientId is required when reconcile guardrails are provided'
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 400 when guardrails are provided without requiredCursor', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-1',
          clientId: 'desktop'
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error:
          'requiredCursor is required when reconcile guardrails are provided'
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 409 when reconcile visibility is behind requested checkpoint', async () => {
      const authHeader = await createAuthHeader();
      const requiredCursor = encodeVfsSyncCursor({
        changedAt: '2026-02-14T10:00:02.000Z',
        changeId: 'desktop-2'
      });

      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT staging
        .mockResolvedValueOnce({
          rows: [
            {
              last_reconciled_at: '2026-02-14T10:00:01.000Z',
              last_reconciled_change_id: 'desktop-1',
              last_reconciled_write_ids: {
                desktop: 1
              }
            }
          ]
        }) // SELECT reconcile
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-1',
          clientId: 'desktop',
          requiredCursor,
          requiredLastReconciledWriteIds: {
            desktop: 2
          }
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Client reconcile state is behind required visibility'
      });
      expect(mockQuery.mock.calls[3]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when requiredCursor is invalid for visibility guardrails', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-1',
          clientId: 'desktop',
          requiredCursor: 'not-a-cursor'
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid requiredCursor' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 400 when requiredLastReconciledWriteIds is invalid', async () => {
      const authHeader = await createAuthHeader();
      const requiredCursor = encodeVfsSyncCursor({
        changedAt: '2026-02-14T10:00:02.000Z',
        changeId: 'desktop-2'
      });

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-1',
          clientId: 'desktop',
          requiredCursor,
          requiredLastReconciledWriteIds: {
            desktop: 0
          }
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error:
          'lastReconciledWriteIds contains invalid writeId (must be a positive integer)'
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 500 when reconcile state row contains invalid write ids', async () => {
      const authHeader = await createAuthHeader();
      const requiredCursor = encodeVfsSyncCursor({
        changedAt: '2026-02-14T10:00:02.000Z',
        changeId: 'desktop-2'
      });

      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT staging
        .mockResolvedValueOnce({
          rows: [
            {
              last_reconciled_at: '2026-02-14T10:00:03.000Z',
              last_reconciled_change_id: 'desktop-3',
              last_reconciled_write_ids: {
                desktop: 'oops'
              }
            }
          ]
        }) // SELECT reconcile
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({
          itemId: 'item-1',
          clientId: 'desktop',
          requiredCursor
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to attach staged blob' });
      expect(mockQuery.mock.calls[3]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when insert conflict fallback cannot find an existing ref', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT ... FOR UPDATE (staging)
        .mockResolvedValueOnce({
          rows: [
            {
              blob_id: 'blob-1',
              attached_at: '2026-02-14T10:10:00.000Z',
              attached_item_id: 'item-1'
            }
          ]
        }) // UPDATE
        .mockResolvedValueOnce({
          rowCount: 1
        }) // UPSERT blob into vfs_registry
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({ rows: [] }) // INSERT ref conflict
        .mockResolvedValueOnce({ rows: [] }) // SELECT existing ref missing
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1', relationKind: 'file' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to attach staged blob' });
      expect(mockQuery.mock.calls[7]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
      restoreConsole();
    });

    it('returns 409 when existing blob link has a different relation kind', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT staging
        .mockResolvedValueOnce({
          rows: [
            {
              blob_id: 'blob-1',
              attached_at: '2026-02-14T10:10:00.000Z',
              attached_item_id: 'item-1'
            }
          ]
        }) // UPDATE
        .mockResolvedValueOnce({
          rowCount: 1
        }) // UPSERT blob into vfs_registry
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({ rows: [] }) // INSERT blob link conflict
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'existing-ref-1',
              created_at: '2026-02-14T10:10:01.000Z',
              wrapped_session_key: 'blob-link:photo',
              visible_children: {
                relationKind: 'photo',
                attachedBy: 'user-1'
              }
            }
          ]
        }) // SELECT existing link
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1', relationKind: 'file' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob is already attached with a different relation kind'
      });
      expect(mockQuery.mock.calls[7]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when blob id resolves to non-blob VFS object type', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT staging
        .mockResolvedValueOnce({
          rows: [
            {
              blob_id: 'blob-1',
              attached_at: '2026-02-14T10:10:00.000Z',
              attached_item_id: 'item-1'
            }
          ]
        }) // UPDATE
        .mockResolvedValueOnce({
          rowCount: 0
        }) // UPSERT blob into vfs_registry
        .mockResolvedValueOnce({
          rows: [{ object_type: 'note' }]
        }) // SELECT blob registry row
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1', relationKind: 'file' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob object id conflicts with existing VFS object'
      });
      expect(mockQuery.mock.calls[5]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when staged blob is already attached', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'attached',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob staging is no longer attachable'
      });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 403 when staged blob belongs to a different user', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-2',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1' });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when staged blob has expired', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2000-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Blob staging has expired' });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when update guardrail detects attach race', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT
        .mockResolvedValueOnce({ rows: [] }) // guarded UPDATE
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob staging is no longer attachable'
      });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('rolls back and returns 500 when attach fails mid-transaction', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stage-1',
              blob_id: 'blob-1',
              staged_by: 'user-1',
              status: 'staged',
              expires_at: '2099-02-14T11:00:00.000Z'
            }
          ]
        }) // SELECT
        .mockResolvedValueOnce({
          rows: [
            {
              blob_id: 'blob-1',
              attached_at: '2026-02-14T10:10:00.000Z',
              attached_item_id: 'item-1'
            }
          ]
        }) // UPDATE
        .mockResolvedValueOnce({
          rowCount: 1
        }) // UPSERT blob into vfs_registry
        .mockResolvedValueOnce({
          rows: [{ object_type: 'blob' }]
        }) // SELECT blob registry row
        .mockRejectedValueOnce(new Error('insert ref failed')) // INSERT blob link
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/attach')
        .set('Authorization', authHeader)
        .send({ itemId: 'item-1', relationKind: 'file' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to attach staged blob' });
      expect(mockQuery.mock.calls[6]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
      restoreConsole();
    });
  });

  describe('POST /vfs/blobs/stage/:stagingId/abandon', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app).post(
        '/v1/vfs/blobs/stage/stage-1/abandon'
      );

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 when stagingId is missing', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/%20/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'stagingId is required' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 404 when staged blob is missing', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Blob staging not found' });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 200 when abandon succeeds', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'stage-1', staged_by: 'user-1', status: 'staged' }]
        }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        abandoned: true,
        stagingId: 'stage-1',
        status: 'abandoned'
      });
      expect(mockQuery.mock.calls[1]?.[0]).toContain('FOR UPDATE');
      expect(mockQuery.mock.calls[2]?.[0]).toContain(
        "wrapped_session_key = 'blob-stage:staged'"
      );
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 403 when staged blob belongs to a different user', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'stage-1', staged_by: 'user-2', status: 'staged' }]
        }) // SELECT
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when staged blob is no longer staged', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'stage-1', staged_by: 'user-1', status: 'attached' }]
        }) // SELECT
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob staging is no longer abandonable'
      });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when update guardrail detects abandon race', async () => {
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'stage-1', staged_by: 'user-1', status: 'staged' }]
        }) // SELECT
        .mockResolvedValueOnce({ rowCount: 0 }) // guarded UPDATE
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Blob staging is no longer abandonable'
      });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('rolls back and returns 500 when abandon fails mid-transaction', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'stage-1', staged_by: 'user-1', status: 'staged' }]
        }) // SELECT
        .mockRejectedValueOnce(new Error('update failed')) // UPDATE
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to abandon staged blob' });
      expect(mockQuery.mock.calls[3]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
      restoreConsole();
    });

    it('returns 500 when rollback also fails', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'stage-1', staged_by: 'user-1', status: 'staged' }]
        }) // SELECT
        .mockRejectedValueOnce(new Error('update failed')) // UPDATE
        .mockRejectedValueOnce(new Error('rollback failed')); // ROLLBACK

      const response = await request(app)
        .post('/v1/vfs/blobs/stage/stage-1/abandon')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to abandon staged blob' });
      expect(mockQuery.mock.calls[3]?.[0]).toBe('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
      restoreConsole();
    });
  });
});
