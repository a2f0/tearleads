import type { Server } from 'node:http';
import { Code, ConnectError, createPromiseClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { AuthService } from '@tearleads/shared/gen/tearleads/v1/auth_connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createJwt, verifyJwt, verifyRefreshJwt } from '../lib/jwt.js';
import {
  createSession,
  deleteRefreshToken,
  deleteSession,
  getRefreshToken,
  getSession,
  storeRefreshToken
} from '../lib/sessions.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../lib/postgres.js', () => ({
  closePostgresPool: vi.fn().mockResolvedValue(undefined),
  getPool: () => mockGetPostgresPool(),
  getPostgresPool: () => mockGetPostgresPool()
}));

function getBaseUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server did not provide an address');
  }
  const { port } = address;
  return `http://127.0.0.1:${port}`;
}

function createAuthClient(server: Server) {
  const transport = createConnectTransport({
    httpVersion: '1.1',
    baseUrl: `${getBaseUrl(server)}/v1/connect`
  });
  return createPromiseClient(AuthService, transport);
}

function startServer(): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe('Connect AuthService', () => {
  let server: Server;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
    });
    server = await startServer();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await closeServer(server);
  });

  it('returns unauthenticated for GetSessions without bearer token', async () => {
    const client = createAuthClient(server);

    await expect(client.getSessions({})).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('returns sessions for authenticated GetSessions', async () => {
    const userId = 'connect-auth-user-1';
    const sessionId = 'connect-auth-session-1';

    await createSession(sessionId, {
      userId,
      email: 'connect-auth-user@example.com',
      admin: false,
      ipAddress: '127.0.0.1'
    });

    const token = createJwt(
      {
        sub: userId,
        email: 'connect-auth-user@example.com',
        jti: sessionId
      },
      'test-secret',
      3600
    );

    try {
      const client = createAuthClient(server);

      const response = await client.getSessions(
        {},
        {
          headers: {
            authorization: `Bearer ${token}`
          }
        }
      );

      const currentSession = response.sessions.find((session) => {
        return session.id === sessionId;
      });

      expect(currentSession).toBeDefined();
      expect(currentSession?.isCurrent).toBe(true);
      expect(currentSession?.ipAddress).toBe('127.0.0.1');
    } finally {
      await deleteSession(sessionId, userId);
    }
  });

  it('returns unauthenticated for malformed bearer token', async () => {
    const client = createAuthClient(server);

    try {
      await client.getSessions(
        {},
        {
          headers: {
            authorization: 'Bearer malformed-token'
          }
        }
      );
      throw new Error('Expected unauthenticated error');
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      if (!(error instanceof ConnectError)) {
        throw error;
      }
      expect(error.code).toBe(Code.Unauthenticated);
    }
  });

  it('returns invalid argument for Register with invalid email format', async () => {
    const client = createAuthClient(server);

    await expect(
      client.register({
        email: 'not-an-email',
        password: 'SecurePassword123!'
      })
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('registers user and creates tokens on successful Register', async () => {
    const client = createAuthClient(server);
    const mockClient = {
      query: vi.fn(),
      release: vi.fn()
    };
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockGetPostgresPool.mockResolvedValue({
      connect: vi.fn().mockResolvedValue(mockClient),
      query: mockQuery
    });

    const response = await client.register({
      email: 'newuser@example.com',
      password: 'SecurePassword123!'
    });

    expect(response.accessToken).toEqual(expect.any(String));
    expect(response.refreshToken).toEqual(expect.any(String));
    expect(response.tokenType).toBe('Bearer');
    expect(response.expiresIn).toBe(3600);
    expect(response.refreshExpiresIn).toBe(604800);
    expect(response.user).toBeDefined();
    if (!response.user) {
      throw new Error('Expected user payload');
    }
    expect(response.user).toMatchObject({
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

    const claims = verifyJwt(response.accessToken, 'test-secret');
    if (claims) {
      await deleteSession(claims.jti, response.user.id);
    }
    const refreshClaims = verifyRefreshJwt(
      response.refreshToken,
      'test-secret'
    );
    if (refreshClaims) {
      await deleteRefreshToken(refreshClaims.jti);
    }
  });

  it('returns invalid argument for RefreshToken when refreshToken is missing', async () => {
    const client = createAuthClient(server);

    await expect(
      client.refreshToken({
        refreshToken: ''
      })
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns unauthenticated for RefreshToken with invalid JWT', async () => {
    const client = createAuthClient(server);

    await expect(
      client.refreshToken({
        refreshToken: 'invalid-token'
      })
    ).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('rotates tokens on successful RefreshToken call', async () => {
    const client = createAuthClient(server);
    const userId = 'connect-refresh-user-1';
    const oldSessionId = 'connect-refresh-session-1';
    const oldRefreshTokenId = 'connect-refresh-token-1';
    let newSessionId: string | null = null;
    let newRefreshTokenId: string | null = null;

    await createSession(
      oldSessionId,
      {
        userId,
        email: 'connect-refresh@example.com',
        admin: true,
        ipAddress: '127.0.0.1'
      },
      604800
    );
    await storeRefreshToken(
      oldRefreshTokenId,
      { sessionId: oldSessionId, userId },
      604800
    );

    const oldRefreshToken = createJwt(
      {
        sub: userId,
        jti: oldRefreshTokenId,
        sid: oldSessionId,
        type: 'refresh'
      },
      'test-secret',
      604800
    );

    try {
      const response = await client.refreshToken({
        refreshToken: oldRefreshToken
      });

      expect(response.accessToken).toEqual(expect.any(String));
      expect(response.refreshToken).toEqual(expect.any(String));
      expect(response.user?.id).toBe(userId);
      expect(response.user?.email).toBe('connect-refresh@example.com');

      const accessClaims = verifyJwt(response.accessToken, 'test-secret');
      expect(accessClaims).not.toBeNull();
      if (!accessClaims) {
        throw new Error('Expected refreshed access token claims');
      }
      newSessionId = accessClaims.jti;

      const refreshClaims = verifyRefreshJwt(
        response.refreshToken,
        'test-secret'
      );
      expect(refreshClaims).not.toBeNull();
      if (!refreshClaims) {
        throw new Error('Expected refreshed refresh token claims');
      }
      newRefreshTokenId = refreshClaims.jti;

      const oldSession = await getSession(oldSessionId);
      expect(oldSession).toBeNull();
      const oldRefresh = await getRefreshToken(oldRefreshTokenId);
      expect(oldRefresh).toBeNull();

      const rotatedSession = await getSession(newSessionId);
      expect(rotatedSession).toMatchObject({
        userId,
        email: 'connect-refresh@example.com',
        admin: true
      });
      const rotatedRefresh = await getRefreshToken(newRefreshTokenId);
      expect(rotatedRefresh).toMatchObject({
        sessionId: newSessionId,
        userId
      });
    } finally {
      await deleteSession(oldSessionId, userId);
      await deleteRefreshToken(oldRefreshTokenId);
      if (newSessionId) {
        await deleteSession(newSessionId, userId);
      }
      if (newRefreshTokenId) {
        await deleteRefreshToken(newRefreshTokenId);
      }
    }
  });
});
