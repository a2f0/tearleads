import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createJwt, verifyJwt } from '../lib/jwt.js';
import { hashPassword } from '../lib/passwords.js';
import { createSession, deleteSession, getSession } from '../lib/sessions.js';
import { mockConsoleError } from '../test/console-mocks.js';

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

  it('returns 400 when payload is missing', async () => {
    const response = await request(app).post('/v1/auth/login').send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'email and password are required' });
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
          password_salt: credentials.salt
        }
      ]
    });

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'user@example.com', password: 'password' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid email or password' });
  });

  it('returns 200 with access token on success', async () => {
    const password = 'correct-password';
    const credentials = await hashPassword(password);

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-1',
          email: 'user@example.com',
          password_hash: credentials.hash,
          password_salt: credentials.salt
        }
      ]
    });

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'user@example.com', password });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.tokenType).toBe('Bearer');
    expect(response.body.expiresIn).toBe(3600);
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
      ipAddress: expect.any(String)
    });
    expect(session?.createdAt).toEqual(expect.any(String));
    expect(session?.lastActiveAt).toEqual(expect.any(String));
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
        ipAddress: '127.0.0.1'
      });
      await createSession(otherSessionId, {
        userId,
        email: 'user@example.com',
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
        ipAddress: '127.0.0.1'
      });
      await createSession(otherSessionId, {
        userId,
        email: 'user@example.com',
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
        ipAddress: '127.0.0.1'
      });
      await createSession(otherUserSessionId, {
        userId: otherUserId,
        email: 'other@example.com',
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
