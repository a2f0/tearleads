import { wasApiRequestMade } from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiCoreRuntimeForTesting } from './apiCore';
import { resetAuthStorageRuntimeForTesting } from './authStorage';
import { setTestEnv } from './test/env.js';

const mockLogApiEvent = vi.fn();
const NON_SENSITIVE_ACCESS_TOKEN = 'msw-parity-non-sensitive-token';

describe('api with msw', () => {
  beforeEach(async () => {
    resetAuthStorageRuntimeForTesting();
    vi.clearAllMocks();
    setTestEnv('VITE_API_URL', 'http://localhost');
    resetApiCoreRuntimeForTesting();
    localStorage.clear();
    mockLogApiEvent.mockResolvedValue(undefined);
    const { setApiEventLogger } = await import('./apiLogger');
    setApiEventLogger((...args: Parameters<typeof mockLogApiEvent>) =>
      mockLogApiEvent(...args)
    );
  });

  afterEach(async () => {
    const { resetApiEventLogger } = await import('./apiLogger');
    resetApiEventLogger();
  });

  it('covers non-wrapper API parity endpoints', async () => {
    const authHeaders: Record<string, string> = {
      Authorization: `Bearer ${NON_SENSITIVE_ACCESS_TOKEN}`
    };

    const requests: Array<{
      method: string;
      pathname: string;
      init?: RequestInit;
    }> = [
      { method: 'GET', pathname: '/billing/organizations/org-1' },
      { method: 'GET', pathname: '/vfs/emails' },
      { method: 'GET', pathname: '/vfs/emails/email-1' },
      {
        method: 'POST',
        pathname: '/vfs/emails/send',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: 'user@example.com' })
        }
      },
      { method: 'DELETE', pathname: '/vfs/emails/email-1' },
      { method: 'GET', pathname: '/mls/groups' },
      { method: 'GET', pathname: '/mls/groups/group-1' },
      { method: 'GET', pathname: '/mls/groups/group-1/members' },
      { method: 'GET', pathname: '/mls/groups/group-1/messages' },
      { method: 'GET', pathname: '/mls/groups/group-1/state' },
      { method: 'GET', pathname: '/mls/key-packages/me' },
      { method: 'GET', pathname: '/mls/key-packages/user-1' },
      { method: 'GET', pathname: '/mls/welcome-messages' },
      {
        method: 'POST',
        pathname: '/mls/groups',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'group' })
        }
      },
      {
        method: 'POST',
        pathname: '/mls/groups/group-1/members',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'user-2' })
        }
      },
      {
        method: 'POST',
        pathname: '/mls/groups/group-1/messages',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encryptedMessage: 'message' })
        }
      },
      {
        method: 'POST',
        pathname: '/mls/groups/group-1/state',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encryptedState: 'state' })
        }
      },
      {
        method: 'POST',
        pathname: '/mls/key-packages',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyPackage: 'key-package' })
        }
      },
      {
        method: 'POST',
        pathname: '/mls/welcome-messages/message-1/ack',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }
      },
      {
        method: 'PATCH',
        pathname: '/mls/groups/group-1',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'updated' })
        }
      },
      { method: 'DELETE', pathname: '/mls/groups/group-1/members/user-1' },
      { method: 'DELETE', pathname: '/mls/groups/group-1' },
      { method: 'DELETE', pathname: '/mls/key-packages/key-1' },
      {
        method: 'POST',
        pathname: '/revenuecat/webhooks',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'purchase' })
        }
      }
    ];

    for (const request of requests) {
      const initHeaders = (request.init?.headers ?? {}) as Record<
        string,
        string
      >;
      const response = await fetch(`http://localhost${request.pathname}`, {
        method: request.method,
        headers: { ...authHeaders, ...initHeaders },
        ...(request.init?.body !== undefined ? { body: request.init.body } : {})
      });
      // Verify the request reached the server (not a network error).
      // We don't assert response.ok because many endpoints return 4xx/5xx
      // without full data setup — the parity test validates MSW captures
      // the request, not that the endpoint succeeds.
      expect(
        response.status,
        `${request.method} ${request.pathname} got no response`
      ).toBeGreaterThanOrEqual(200);
    }

    for (const request of requests) {
      expect(wasApiRequestMade(request.method, request.pathname)).toBe(true);
    }
  });
});
