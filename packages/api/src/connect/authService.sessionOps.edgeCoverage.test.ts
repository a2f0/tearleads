import type { Server } from 'node:http';
import { Code, createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { AuthService } from '@tearleads/shared/gen/tearleads/v2/auth_pb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createJwt } from '../lib/jwt.js';
import * as sessions from '../lib/sessions.js';
import { setTestEnv } from '../test/env.js';

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
  return createClient(AuthService, transport);
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

describe('Connect AuthService session operations edge coverage', () => {
  let server: Server;

  beforeEach(async () => {
    vi.clearAllMocks();
    setTestEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
    });
    server = await startServer();
  });

  afterEach(async () => {
    await closeServer(server);
  });

  it('returns internal when logout session deletion fails unexpectedly', async () => {
    const client = createAuthClient(server);
    const userId = 'connect-logout-user-edge';
    const sessionId = 'connect-logout-session-edge';

    await sessions.createSession(sessionId, {
      userId,
      email: 'connect-logout-edge@example.com',
      admin: false,
      ipAddress: '127.0.0.1'
    });

    const token = createJwt(
      {
        sub: userId,
        email: 'connect-logout-edge@example.com',
        jti: sessionId
      },
      'test-secret',
      3600
    );

    const deleteSessionSpy = vi
      .spyOn(sessions, 'deleteSession')
      .mockRejectedValueOnce(new Error('forced failure'));
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      await expect(
        client.logout(
          {},
          {
            headers: {
              authorization: `Bearer ${token}`
            }
          }
        )
      ).rejects.toMatchObject({
        code: Code.Internal
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to logout session',
        expect.any(Error)
      );
    } finally {
      consoleErrorSpy.mockRestore();
      deleteSessionSpy.mockRestore();
      await sessions.deleteSession(sessionId, userId);
    }
  });

  it('returns unauthenticated for RefreshToken when token is revoked', async () => {
    const client = createAuthClient(server);
    const refreshToken = createJwt(
      {
        sub: 'revoked-user',
        jti: 'revoked-refresh-token-id',
        sid: 'revoked-session-id',
        type: 'refresh'
      },
      'test-secret',
      604800
    );

    await expect(
      client.refreshToken({
        refreshToken
      })
    ).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('returns unauthenticated and revokes token when refresh session is missing', async () => {
    const client = createAuthClient(server);
    const userId = 'connect-refresh-missing-session-user';
    const oldSessionId = 'connect-refresh-missing-session';
    const oldRefreshTokenId = 'connect-refresh-missing-session-token';

    await sessions.createSession(
      oldSessionId,
      {
        userId,
        email: 'connect-refresh-missing-session@example.com',
        admin: false,
        ipAddress: '127.0.0.1'
      },
      604800
    );
    await sessions.storeRefreshToken(
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

    await sessions.deleteSession(oldSessionId, userId);

    try {
      await expect(
        client.refreshToken({
          refreshToken: oldRefreshToken
        })
      ).rejects.toMatchObject({
        code: Code.Unauthenticated
      });

      const staleRefreshToken =
        await sessions.getRefreshToken(oldRefreshTokenId);
      expect(staleRefreshToken).toBeNull();
    } finally {
      await sessions.deleteRefreshToken(oldRefreshTokenId);
    }
  });
});
