import { getRedisClient } from '@tearleads/shared/redis';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createJwt, verifyJwt, verifyRefreshJwt } from '../../lib/jwt.js';
import {
  createSession,
  deleteRefreshToken,
  deleteSession,
  getRefreshToken,
  getSession,
  storeRefreshToken
} from '../../lib/sessions.js';
import { mockConsoleError } from '../../test/consoleMocks.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
}));

describe('Auth refresh routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POST /auth/refresh', () => {
    it('returns 400 when refreshToken is missing', async () => {
      const response = await request(app).post('/v1/auth/refresh').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'refreshToken is required' });
    });

    it('returns 401 when refresh token JWT is invalid', async () => {
      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Invalid refresh token' });
    });

    it('returns 401 when refresh token has been revoked', async () => {
      const sessionId = 'refresh-test-session-1';
      const userId = 'refresh-test-user-1';

      await createSession(sessionId, {
        userId,
        email: 'refresh@example.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });

      const refreshToken = createJwt(
        {
          sub: userId,
          jti: 'revoked-refresh-token-id',
          sid: sessionId,
          type: 'refresh'
        },
        'test-secret',
        604800
      );

      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Refresh token has been revoked'
      });

      await deleteSession(sessionId, userId);
    });

    it('returns 401 when session no longer exists', async () => {
      const refreshTokenId = 'orphaned-refresh-token';
      const userId = 'refresh-test-user-2';

      await storeRefreshToken(
        refreshTokenId,
        { sessionId: 'nonexistent-session', userId },
        604800
      );

      const refreshToken = createJwt(
        {
          sub: userId,
          jti: refreshTokenId,
          sid: 'nonexistent-session',
          type: 'refresh'
        },
        'test-secret',
        604800
      );

      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Session no longer valid' });

      const tokenAfter = await getRefreshToken(refreshTokenId);
      expect(tokenAfter).toBeNull();
    });

    it('returns 200 with new tokens on successful refresh', async () => {
      const sessionId = 'refresh-test-session-3';
      const refreshTokenId = 'valid-refresh-token-id';
      const userId = 'refresh-test-user-3';

      await createSession(sessionId, {
        userId,
        email: 'refresh@example.com',
        admin: true,
        ipAddress: '127.0.0.1'
      });

      await storeRefreshToken(refreshTokenId, { sessionId, userId }, 604800);

      const refreshToken = createJwt(
        {
          sub: userId,
          jti: refreshTokenId,
          sid: sessionId,
          type: 'refresh'
        },
        'test-secret',
        604800
      );

      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken });

      expect(response.status).toBe(200);
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.refreshToken).toEqual(expect.any(String));
      expect(response.body.tokenType).toBe('Bearer');
      expect(response.body.expiresIn).toBe(3600);
      expect(response.body.refreshExpiresIn).toBe(604800);
      expect(response.body.user).toEqual({
        id: userId,
        email: 'refresh@example.com'
      });

      const oldSession = await getSession(sessionId);
      expect(oldSession).toBeNull();

      const oldRefreshToken = await getRefreshToken(refreshTokenId);
      expect(oldRefreshToken).toBeNull();

      const newClaims = verifyJwt(response.body.accessToken, 'test-secret');
      expect(newClaims).not.toBeNull();
      if (newClaims) {
        const newSession = await getSession(newClaims.jti);
        expect(newSession).toMatchObject({
          userId,
          email: 'refresh@example.com',
          admin: true
        });
        await deleteSession(newClaims.jti, userId);
      }

      const newRefreshClaims = verifyRefreshJwt(
        response.body.refreshToken,
        'test-secret'
      );
      if (newRefreshClaims) {
        await deleteRefreshToken(newRefreshClaims.jti);
      }
    });

    it('stores rotated session with refresh token TTL (not access token TTL)', async () => {
      const sessionId = 'refresh-ttl-session';
      const refreshTokenId = 'refresh-ttl-token-id';
      const userId = 'refresh-ttl-user';

      await createSession(
        sessionId,
        {
          userId,
          email: 'refresh-ttl@example.com',
          admin: false,
          ipAddress: '127.0.0.1'
        },
        604800
      );

      await storeRefreshToken(refreshTokenId, { sessionId, userId }, 604800);

      const refreshToken = createJwt(
        {
          sub: userId,
          jti: refreshTokenId,
          sid: sessionId,
          type: 'refresh'
        },
        'test-secret',
        604800
      );

      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken });

      expect(response.status).toBe(200);

      const newClaims = verifyJwt(response.body.accessToken, 'test-secret');
      expect(newClaims).not.toBeNull();
      if (!newClaims) {
        throw new Error('Expected JWT claims');
      }

      // Verify rotated session TTL matches refresh token TTL (604800s = 7 days)
      // This ensures the fix also applies to token refresh flow
      const client = await getRedisClient();
      const newSessionTtl = await client.ttl(`session:${newClaims.jti}`);

      // TTL should be close to REFRESH_TOKEN_TTL_SECONDS (604800)
      expect(newSessionTtl).toBeGreaterThan(604700);
      expect(newSessionTtl).toBeLessThanOrEqual(604800);

      // Clean up
      await deleteSession(newClaims.jti, userId);
      const newRefreshClaims = verifyRefreshJwt(
        response.body.refreshToken,
        'test-secret'
      );
      if (newRefreshClaims) {
        await deleteRefreshToken(newRefreshClaims.jti);
      }
    });

    it('returns 500 when JWT_SECRET is not configured', async () => {
      mockConsoleError();
      delete process.env['JWT_SECRET'];

      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'some-token' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to refresh token' });

      vi.stubEnv('JWT_SECRET', 'test-secret');
    });
  });
});
