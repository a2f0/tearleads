import { wasApiRequestMade } from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogApiEvent = vi.fn();

describe('api with msw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    localStorage.clear();
    mockLogApiEvent.mockResolvedValue(undefined);
    const { setApiEventLogger } = await import('./apiLogger');
    setApiEventLogger(
      (...args: Parameters<typeof mockLogApiEvent>) => mockLogApiEvent(...args)
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    const { resetApiEventLogger } = await import('./apiLogger');
    resetApiEventLogger();
  });

  it('covers non-wrapper API parity endpoints', async () => {
    const requests: Array<{
      method: string;
      pathname: string;
      init?: RequestInit;
    }> = [
      { method: 'GET', pathname: '/billing/organizations/org-1' },
      { method: 'GET', pathname: '/emails' },
      { method: 'GET', pathname: '/emails/email-1' },
      { method: 'GET', pathname: '/emails/drafts' },
      { method: 'GET', pathname: '/emails/drafts/draft-1' },
      {
        method: 'POST',
        pathname: '/emails/drafts',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject: 'test draft' })
        }
      },
      { method: 'DELETE', pathname: '/emails/drafts/draft-1' },
      {
        method: 'POST',
        pathname: '/emails/send',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: 'user@example.com' })
        }
      },
      { method: 'DELETE', pathname: '/emails/email-1' },
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
      const response = await fetch(`http://localhost${request.pathname}`, {
        method: request.method,
        ...request.init
      });
      expect(response.ok).toBe(true);
    }

    const sse = await fetch('http://localhost/sse');
    expect(sse.ok).toBe(true);
    expect(sse.headers.get('content-type')).toContain('text/event-stream');

    for (const request of requests) {
      expect(wasApiRequestMade(request.method, request.pathname)).toBe(true);
    }
    expect(wasApiRequestMade('GET', '/sse')).toBe(true);
  });
});
