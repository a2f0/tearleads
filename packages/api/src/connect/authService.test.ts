import type { Server } from 'node:http';
import { Code, ConnectError, createPromiseClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { AuthService } from '@tearleads/shared/gen/tearleads/v1/auth_connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createJwt, verifyJwt, verifyRefreshJwt } from '../lib/jwt.js';
import { hashPassword } from '../lib/passwords.js';
import {
  createSession,
  deleteRefreshToken,
  deleteSession
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

  it('returns invalid argument for Login when payload is missing', async () => {
    const client = createAuthClient(server);

    await expect(
      client.login({
        email: '',
        password: ''
      })
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns tokens for successful Login', async () => {
    const client = createAuthClient(server);
    const password = 'SecurePassword123!';
    const credentials = await hashPassword(password);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'connect-login-user-1',
          email: 'connect-login@example.com',
          password_hash: credentials.hash,
          password_salt: credentials.salt,
          admin: false
        }
      ]
    });

    const response = await client.login({
      email: 'connect-login@example.com',
      password
    });

    expect(response.accessToken).toEqual(expect.any(String));
    expect(response.refreshToken).toEqual(expect.any(String));
    expect(response.user?.id).toBe('connect-login-user-1');

    const accessClaims = verifyJwt(response.accessToken, 'test-secret');
    expect(accessClaims).not.toBeNull();
    if (!accessClaims) {
      throw new Error('Expected access token claims');
    }
    const refreshClaims = verifyRefreshJwt(
      response.refreshToken,
      'test-secret'
    );
    expect(refreshClaims).not.toBeNull();

    await deleteSession(accessClaims.jti, 'connect-login-user-1');
    if (refreshClaims) {
      await deleteRefreshToken(refreshClaims.jti);
    }
  });

  it('returns unauthenticated for Login with wrong password', async () => {
    const client = createAuthClient(server);
    const credentials = await hashPassword('DifferentPassword123!');
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'connect-login-user-2',
          email: 'connect-login2@example.com',
          password_hash: credentials.hash,
          password_salt: credentials.salt,
          admin: false
        }
      ]
    });

    await expect(
      client.login({
        email: 'connect-login2@example.com',
        password: 'WrongPassword123!'
      })
    ).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
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

  it('returns already exists when Register email is already used', async () => {
    const client = createAuthClient(server);
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'existing-user' }]
    });

    await expect(
      client.register({
        email: 'existing@example.com',
        password: 'SecurePassword123!'
      })
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });
});
