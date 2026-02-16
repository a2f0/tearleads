import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createJwt, verifyJwt, verifyRefreshJwt } from '../lib/jwt.js';
import { hashPassword } from '../lib/passwords.js';
import { getRedisClient } from '../lib/redis.js';
import {
  createSession,
  deleteRefreshToken,
  deleteSession,
  getRefreshToken,
  getSession,
  storeRefreshToken
} from '../lib/sessions.js';
import { mockConsoleError } from '../test/consoleMocks.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
}));

describe('Auth routes', () => {
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

  it('returns 400 when payload is missing', { timeout: 15000 }, async () => {
    const response = await request(app).post('/v1/auth/login').send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'email and password are required'
    });
  });

  it('returns 401 when user is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'user@example.com', password: 'password' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid email or password' });
  });

  it('returns 401 when password does not match', async () => {
    const credentials = await hashPassword('other-password');
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-1',
          email: 'user@example.com',
          password_hash: credentials.hash,
          password_salt: credentials.salt,
          admin: false
        }
      ]
    });

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'user@example.com', password: 'password' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid email or password' });
  });

  it('returns 200 with access and refresh tokens on success', async () => {
    const password = 'correct-password';
    const credentials = await hashPassword(password);

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-1',
          email: 'user@example.com',
          password_hash: credentials.hash,
          password_salt: credentials.salt,
          admin: false
        }
      ]
    });

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'user@example.com', password });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
    expect(response.body.tokenType).toBe('Bearer');
    expect(response.body.expiresIn).toBe(3600);
    expect(response.body.refreshExpiresIn).toBe(604800);
    expect(response.body.user).toEqual({
      id: 'user-1',
      email: 'user@example.com'
    });

    const claims = verifyJwt(response.body.accessToken, 'test-secret');
    expect(claims).not.toBeNull();
    if (!claims) {
      throw new Error('Expected JWT claims');
    }
    const session = await getSession(claims.jti);
    expect(session).toMatchObject({
      userId: 'user-1',
      email: 'user@example.com',
      admin: false,
      ipAddress: expect.any(String)
    });
    expect(session?.createdAt).toEqual(expect.any(String));
    expect(session?.lastActiveAt).toEqual(expect.any(String));

    const refreshClaims = verifyRefreshJwt(
      response.body.refreshToken,
      'test-secret'
    );
    expect(refreshClaims).not.toBeNull();
    expect(refreshClaims?.sub).toBe('user-1');
    expect(refreshClaims?.sid).toBe(claims.jti);
    expect(refreshClaims?.type).toBe('refresh');

    if (refreshClaims) {
      const refreshTokenData = await getRefreshToken(refreshClaims.jti);
      expect(refreshTokenData).toMatchObject({
        sessionId: claims.jti,
        userId: 'user-1'
      });
      await deleteRefreshToken(refreshClaims.jti);
    }
    await deleteSession(claims.jti, 'user-1');
  });

  it('stores session with refresh token TTL (not access token TTL)', async () => {
    const password = 'correct-password';
    const credentials = await hashPassword(password);

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'ttl-test-user',
          email: 'ttl@example.com',
          password_hash: credentials.hash,
          password_salt: credentials.salt,
          admin: false
        }
      ]
    });

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'ttl@example.com', password });

    expect(response.status).toBe(200);

    const claims = verifyJwt(response.body.accessToken, 'test-secret');
    expect(claims).not.toBeNull();
    if (!claims) {
      throw new Error('Expected JWT claims');
    }

    // Verify session TTL matches refresh token TTL (604800s = 7 days)
    // rather than access token TTL (3600s = 1 hour)
    const client = await getRedisClient();
    const sessionTtl = await client.ttl(`session:${claims.jti}`);

    // TTL should be close to REFRESH_TOKEN_TTL_SECONDS (604800)
    // Allow some margin for test execution time
    expect(sessionTtl).toBeGreaterThan(604700);
    expect(sessionTtl).toBeLessThanOrEqual(604800);

    // Clean up
    await deleteSession(claims.jti, 'ttl-test-user');
    const refreshClaims = verifyRefreshJwt(
      response.body.refreshToken,
      'test-secret'
    );
    if (refreshClaims) {
      await deleteRefreshToken(refreshClaims.jti);
    }
  });

  it('returns 500 when login query fails', async () => {
    mockConsoleError();
    mockQuery.mockRejectedValueOnce(new Error('db error'));

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'user@example.com', password: 'password' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to authenticate' });
  });

  it('returns 500 when JWT_SECRET is not configured', async () => {
    mockConsoleError();
    vi.unstubAllEnvs();

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'user@example.com', password: 'password' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to authenticate' });
  });

  describe('POST /auth/register', () => {
    it('returns 400 when payload is missing', async () => {
      const response = await request(app).post('/v1/auth/register').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'email and password are required'
      });
    });

    it('returns 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'not-an-email', password: 'SecurePassword123!' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid email format' });
    });

    // COMPLIANCE_SENTINEL: TL-ACCT-001 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=password-complexity
    it('returns 400 for password too short', async () => {
      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'user@example.com', password: 'short' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Password must be at least 12 characters'
      });
    });

    it('returns 400 for password missing complexity requirements', async () => {
      const response = await request(app).post('/v1/auth/register').send({
        email: 'user@example.com',
        password: 'alllowercase1234'
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error:
          'Password must include at least one uppercase letter, one lowercase letter, one number, and one symbol'
      });
    });

    it('returns 400 for invalid email domain when domains are restricted', async () => {
      vi.stubEnv('SMTP_RECIPIENT_DOMAINS', 'allowed.com,another.com');

      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'user@notallowed.com', password: 'SecurePassword123!' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error:
          'Email domain not allowed. Allowed domains: allowed.com, another.com'
      });
    });

    it('returns 409 when email already exists', async () => {
      vi.stubEnv('SMTP_RECIPIENT_DOMAINS', '');
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'existing-user' }]
      });

      const response = await request(app).post('/v1/auth/register').send({
        email: 'existing@example.com',
        password: 'SecurePassword123!'
      });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Email already registered' });
    });

    it('returns 200 with tokens on successful registration', async () => {
      vi.stubEnv('SMTP_RECIPIENT_DOMAINS', '');

      const mockClient = {
        query: vi.fn(),
        release: vi.fn()
      };
      mockQuery.mockResolvedValueOnce({ rows: [] }); // Check for existing user
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery,
        connect: vi.fn().mockResolvedValue(mockClient)
      });

      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'newuser@example.com', password: 'SecurePassword123!' });

      expect(response.status).toBe(200);
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.refreshToken).toEqual(expect.any(String));
      expect(response.body.tokenType).toBe('Bearer');
      expect(response.body.expiresIn).toBe(3600);
      expect(response.body.refreshExpiresIn).toBe(604800);
      expect(response.body.user).toMatchObject({
        id: expect.any(String),
        email: 'newuser@example.com'
      });

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('personal_organization_id'),
        expect.any(Array)
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO organizations'),
        expect.any(Array)
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_organizations'),
        expect.any(Array)
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO organization_billing_accounts'),
        expect.any(Array)
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();

      // Clean up Redis session data
      const claims = verifyJwt(response.body.accessToken, 'test-secret');
      if (claims) {
        await deleteSession(claims.jti, response.body.user.id);
      }
      const refreshClaims = verifyRefreshJwt(
        response.body.refreshToken,
        'test-secret'
      );
      if (refreshClaims) {
        await deleteRefreshToken(refreshClaims.jti);
      }
    });

    it('allows registration when email matches allowed domain', async () => {
      vi.stubEnv('SMTP_RECIPIENT_DOMAINS', 'example.com');

      const mockClient = {
        query: vi.fn(),
        release: vi.fn()
      };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery,
        connect: vi.fn().mockResolvedValue(mockClient)
      });

      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'newuser@example.com', password: 'SecurePassword123!' });

      expect(response.status).toBe(200);

      // Clean up Redis session data
      const claims = verifyJwt(response.body.accessToken, 'test-secret');
      if (claims) {
        await deleteSession(claims.jti, response.body.user.id);
      }
      const refreshClaims = verifyRefreshJwt(
        response.body.refreshToken,
        'test-secret'
      );
      if (refreshClaims) {
        await deleteRefreshToken(refreshClaims.jti);
      }
    });

    it('returns 500 when database query fails', async () => {
      mockConsoleError();
      vi.stubEnv('SMTP_RECIPIENT_DOMAINS', '');
      mockQuery.mockRejectedValueOnce(new Error('db error'));

      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'user@example.com', password: 'SecurePassword123!' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to register' });
    });

    it('returns 500 when JWT_SECRET is not configured', async () => {
      mockConsoleError();
      vi.unstubAllEnvs();

      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'user@example.com', password: 'SecurePassword123!' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to register' });
    });

    it('rolls back transaction on insert failure', async () => {
      mockConsoleError();
      vi.stubEnv('SMTP_RECIPIENT_DOMAINS', '');

      const mockClient = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql === 'BEGIN') return Promise.resolve();
          if (sql.includes('INSERT INTO users')) {
            return Promise.reject(new Error('Insert failed'));
          }
          return Promise.resolve();
        }),
        release: vi.fn()
      };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery,
        connect: vi.fn().mockResolvedValue(mockClient)
      });

      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'newuser@example.com', password: 'SecurePassword123!' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to register' });
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
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

  describe('GET /auth/sessions', () => {
    it('returns 401 without auth token', async () => {
      const response = await request(app).get('/v1/auth/sessions');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns list of sessions for authenticated user', async () => {
      const sessionId = 'test-session-id';
      const userId = 'sessions-test-user-1';

      await createSession(sessionId, {
        userId,
        email: 'sessions-test@example.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });

      const token = createJwt(
        { sub: userId, email: 'sessions-test@example.com', jti: sessionId },
        'test-secret',
        3600
      );

      const response = await request(app)
        .get('/v1/auth/sessions')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.sessions).toHaveLength(1);
      expect(response.body.sessions[0]).toMatchObject({
        id: sessionId,
        ipAddress: '127.0.0.1',
        isCurrent: true
      });

      await deleteSession(sessionId, userId);
    });

    it('marks current session correctly among multiple sessions', async () => {
      const userId = 'user-2';
      const currentSessionId = 'current-session';
      const otherSessionId = 'other-session';

      await createSession(currentSessionId, {
        userId,
        email: 'user@example.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });
      await createSession(otherSessionId, {
        userId,
        email: 'user@example.com',
        admin: false,
        ipAddress: '192.168.1.1'
      });

      const token = createJwt(
        { sub: userId, email: 'user@example.com', jti: currentSessionId },
        'test-secret',
        3600
      );

      const response = await request(app)
        .get('/v1/auth/sessions')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.sessions).toHaveLength(2);

      const currentSession = response.body.sessions.find(
        (s: { id: string }) => s.id === currentSessionId
      );
      const otherSession = response.body.sessions.find(
        (s: { id: string }) => s.id === otherSessionId
      );

      expect(currentSession.isCurrent).toBe(true);
      expect(otherSession.isCurrent).toBe(false);

      await deleteSession(currentSessionId, userId);
      await deleteSession(otherSessionId, userId);
    });
  });

  describe('DELETE /auth/sessions/:sessionId', () => {
    it('returns 401 without auth token', async () => {
      const response = await request(app).delete(
        '/v1/auth/sessions/some-session'
      );

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 403 when trying to delete current session', async () => {
      const sessionId = 'current-session-3';
      const userId = 'user-3';

      await createSession(sessionId, {
        userId,
        email: 'user@example.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });

      const token = createJwt(
        { sub: userId, email: 'user@example.com', jti: sessionId },
        'test-secret',
        3600
      );

      const response = await request(app)
        .delete(`/v1/auth/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Cannot delete current session' });

      const session = await getSession(sessionId);
      expect(session).not.toBeNull();

      await deleteSession(sessionId, userId);
    });

    it('returns 404 when session does not exist', async () => {
      const currentSessionId = 'current-session-4';
      const userId = 'user-4';

      await createSession(currentSessionId, {
        userId,
        email: 'user@example.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });

      const token = createJwt(
        { sub: userId, email: 'user@example.com', jti: currentSessionId },
        'test-secret',
        3600
      );

      const response = await request(app)
        .delete('/v1/auth/sessions/nonexistent-session')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Session not found' });

      await deleteSession(currentSessionId, userId);
    });

    it('successfully deletes another session', async () => {
      const currentSessionId = 'current-session-5';
      const otherSessionId = 'other-session-5';
      const userId = 'user-5';

      await createSession(currentSessionId, {
        userId,
        email: 'user@example.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });
      await createSession(otherSessionId, {
        userId,
        email: 'user@example.com',
        admin: false,
        ipAddress: '192.168.1.1'
      });

      const token = createJwt(
        { sub: userId, email: 'user@example.com', jti: currentSessionId },
        'test-secret',
        3600
      );

      const response = await request(app)
        .delete(`/v1/auth/sessions/${otherSessionId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ deleted: true });

      const deletedSession = await getSession(otherSessionId);
      expect(deletedSession).toBeNull();

      const currentSession = await getSession(currentSessionId);
      expect(currentSession).not.toBeNull();

      await deleteSession(currentSessionId, userId);
    });

    it('returns 404 when trying to delete session belonging to another user', async () => {
      const currentSessionId = 'current-session-6';
      const otherUserSessionId = 'other-user-session-6';
      const userId = 'user-6';
      const otherUserId = 'other-user-6';

      await createSession(currentSessionId, {
        userId,
        email: 'user@example.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });
      await createSession(otherUserSessionId, {
        userId: otherUserId,
        email: 'other@example.com',
        admin: false,
        ipAddress: '192.168.1.1'
      });

      const token = createJwt(
        { sub: userId, email: 'user@example.com', jti: currentSessionId },
        'test-secret',
        3600
      );

      const response = await request(app)
        .delete(`/v1/auth/sessions/${otherUserSessionId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Session not found' });

      const otherSession = await getSession(otherUserSessionId);
      expect(otherSession).not.toBeNull();

      await deleteSession(currentSessionId, userId);
      await deleteSession(otherUserSessionId, otherUserId);
    });

    it('handles errors during session deletion', async () => {
      const consoleSpy = mockConsoleError();
      const currentSessionId = 'current-session-7';
      const otherSessionId = 'other-session-7';
      const userId = 'user-7';

      await createSession(currentSessionId, {
        userId,
        email: 'user@example.com',
        admin: false,
        ipAddress: '127.0.0.1'
      });

      const token = createJwt(
        { sub: userId, email: 'user@example.com', jti: currentSessionId },
        'test-secret',
        3600
      );

      const sessionsModule = await import('../lib/sessions.js');
      const deleteSessionSpy = vi
        .spyOn(sessionsModule, 'deleteSession')
        .mockRejectedValueOnce(new Error('Redis connection failed'));

      const response = await request(app)
        .delete(`/v1/auth/sessions/${otherSessionId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to delete session' });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete session:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
      deleteSessionSpy.mockRestore();
      await deleteSession(currentSessionId, userId);
    });
  });
});
