import type { Server } from 'node:http';
import { Code, createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { AuthService } from '@tearleads/shared/gen/tearleads/v2/auth_pb';
import request from 'supertest';
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

describe('Connect AuthService session operations', () => {
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

  it('returns unauthenticated for RefreshToken when refresh credential is missing', async () => {
    const client = createAuthClient(server);

    await expect(
      client.refreshToken({
        refreshToken: ''
      })
    ).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('returns organizations for authenticated user', async () => {
    const client = createAuthClient(server);
    const userId = 'connect-org-user-1';
    const sessionId = 'connect-org-session-1';

    await createSession(sessionId, {
      userId,
      email: 'connect-org@example.com',
      admin: false,
      ipAddress: '127.0.0.1'
    });

    const token = createJwt(
      {
        sub: userId,
        email: 'connect-org@example.com',
        jti: sessionId
      },
      'test-secret',
      3600
    );

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'org-1', name: 'Org 1', is_personal: false }]
      })
      .mockResolvedValueOnce({
        rows: [{ personal_organization_id: 'org-1' }]
      });

    try {
      const response = await client.getOrganizations(
        {},
        {
          headers: {
            authorization: `Bearer ${token}`
          }
        }
      );

      expect(response.organizations).toHaveLength(1);
      expect(response.organizations[0]).toMatchObject({
        id: 'org-1',
        name: 'Org 1',
        isPersonal: false
      });
      expect(response.personalOrganizationId).toBe('org-1');
    } finally {
      await deleteSession(sessionId, userId);
    }
  });

  it('returns permission denied when deleting current session', async () => {
    const client = createAuthClient(server);
    const userId = 'connect-delete-user-1';
    const sessionId = 'connect-delete-session-1';

    await createSession(sessionId, {
      userId,
      email: 'connect-delete@example.com',
      admin: false,
      ipAddress: '127.0.0.1'
    });

    const token = createJwt(
      {
        sub: userId,
        email: 'connect-delete@example.com',
        jti: sessionId
      },
      'test-secret',
      3600
    );

    try {
      await expect(
        client.deleteSession(
          {
            sessionId
          },
          {
            headers: {
              authorization: `Bearer ${token}`
            }
          }
        )
      ).rejects.toMatchObject({
        code: Code.PermissionDenied
      });
    } finally {
      await deleteSession(sessionId, userId);
    }
  });

  it('returns invalid argument when DeleteSession sessionId is empty', async () => {
    const client = createAuthClient(server);
    const userId = 'connect-delete-user-2';
    const sessionId = 'connect-delete-session-2';

    await createSession(sessionId, {
      userId,
      email: 'connect-delete2@example.com',
      admin: false,
      ipAddress: '127.0.0.1'
    });

    const token = createJwt(
      {
        sub: userId,
        email: 'connect-delete2@example.com',
        jti: sessionId
      },
      'test-secret',
      3600
    );

    try {
      await expect(
        client.deleteSession(
          {
            sessionId: ' '
          },
          {
            headers: {
              authorization: `Bearer ${token}`
            }
          }
        )
      ).rejects.toMatchObject({
        code: Code.InvalidArgument
      });
    } finally {
      await deleteSession(sessionId, userId);
    }
  });

  it('logs out authenticated user and deletes current session', async () => {
    const client = createAuthClient(server);
    const userId = 'connect-logout-user-1';
    const sessionId = 'connect-logout-session-1';

    await createSession(sessionId, {
      userId,
      email: 'connect-logout@example.com',
      admin: false,
      ipAddress: '127.0.0.1'
    });

    const token = createJwt(
      {
        sub: userId,
        email: 'connect-logout@example.com',
        jti: sessionId
      },
      'test-secret',
      3600
    );

    const response = await client.logout(
      {},
      {
        headers: {
          authorization: `Bearer ${token}`
        }
      }
    );

    expect(response.loggedOut).toBe(true);
    const deletedSession = await getSession(sessionId);
    expect(deletedSession).toBeNull();
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

  it('accepts refresh token from HttpOnly cookie when request payload is empty', async () => {
    const userId = 'connect-refresh-user-cookie';
    const oldSessionId = 'connect-refresh-session-cookie';
    const oldRefreshTokenId = 'connect-refresh-token-cookie';
    let newSessionId: string | null = null;
    let newRefreshTokenId: string | null = null;

    await createSession(
      oldSessionId,
      {
        userId,
        email: 'connect-refresh-cookie@example.com',
        admin: false,
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
      const response = await request(app)
        .post('/v1/connect/tearleads.v2.AuthService/RefreshToken')
        .set('Content-Type', 'application/json')
        .set(
          'Cookie',
          `tearleads_refresh_token=${encodeURIComponent(oldRefreshToken)}`
        )
        .send({});

      expect(response.status).toBe(200);
      const body = response.body;
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.refreshToken).toEqual(expect.any(String));

      const accessClaims = verifyJwt(body.accessToken, 'test-secret');
      expect(accessClaims).not.toBeNull();
      newSessionId = accessClaims?.jti ?? null;

      const refreshClaims = verifyRefreshJwt(body.refreshToken, 'test-secret');
      expect(refreshClaims).not.toBeNull();
      newRefreshTokenId = refreshClaims?.jti ?? null;

      const setCookie = response.get('set-cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContainEqual(
        expect.stringContaining('tearleads_refresh_token=')
      );
      expect(setCookie).toContainEqual(expect.stringContaining('HttpOnly'));
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
      newSessionId = accessClaims?.jti ?? '';
      expect(newSessionId).toBeTruthy();

      const refreshClaims = verifyRefreshJwt(
        response.refreshToken,
        'test-secret'
      );
      expect(refreshClaims).not.toBeNull();
      newRefreshTokenId = refreshClaims?.jti ?? '';
      expect(newRefreshTokenId).toBeTruthy();

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
