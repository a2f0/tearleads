import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';
import { mockConsoleError } from '../test/consoleMocks.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

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
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
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
});
