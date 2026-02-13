import { MLS_CIPHERSUITES } from '@tearleads/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';
import { mockConsoleError } from '../test/console-mocks.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

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

describe('MLS routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore.clear();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('GET /v1/mls/key-packages/:userId', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app).get('/v1/mls/key-packages/user-2');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 404 when target user is outside caller org scope', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/v1/mls/key-packages/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'User not found' });
      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INNER JOIN user_organizations target_uo'),
        ['user-1', 'user-2']
      );
    });

    it('returns key packages when target user shares an organization', async () => {
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery.mockResolvedValueOnce({ rows: [{}] }).mockResolvedValueOnce({
        rows: [
          {
            id: 'kp-1',
            key_package_data: 'encoded-kp',
            key_package_ref: 'kp-ref',
            cipher_suite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519,
            created_at: new Date('2024-01-01T00:00:00.000Z')
          }
        ]
      });

      const response = await request(app)
        .get('/v1/mls/key-packages/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        keyPackages: [
          {
            id: 'kp-1',
            userId: 'user-2',
            keyPackageData: 'encoded-kp',
            keyPackageRef: 'kp-ref',
            cipherSuite: MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519,
            createdAt: '2024-01-01T00:00:00.000Z',
            consumed: false
          }
        ]
      });
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('FROM mls_key_packages'),
        ['user-2']
      );
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader({
        id: 'user-1',
        email: 'user-1@example.com'
      });

      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/v1/mls/key-packages/user-2')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get key packages' });
      restoreConsole();
    });
  });
});
