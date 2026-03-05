import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('api request context headers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
    vi.doMock('./pingWasmImport', () => ({
      importPingWasmModule: () =>
        Promise.resolve({
          v2_ping_path: () => '/v2/ping',
          parse_v2_ping_value: (payload: unknown) => {
            if (typeof payload !== 'object' || payload === null) {
              throw new Error('Invalid v2 ping response payload');
            }
            return payload;
          }
        })
    }));
    global.fetch = vi.fn();
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_refresh_token');
    localStorage.removeItem('auth_user');
    localStorage.removeItem('auth_refresh_lock');
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    const { resetApiRequestHeadersProvider } = await import('./api');
    resetApiRequestHeadersProvider();
  });

  it('applies provider headers to requests and retries', async () => {
    localStorage.setItem('auth_token', 'stale-token');
    (await import('./authStorage')).setStoredRefreshToken('refresh-token');

    const seenOrgHeaders: Array<string | null> = [];

    vi.mocked(global.fetch).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.endsWith('/v2/ping')) {
          const headers = new Headers(init?.headers);
          seenOrgHeaders.push(headers.get('X-Organization-Id'));
          if (headers.get('Authorization') === 'Bearer stale-token') {
            return new Response(null, { status: 401 });
          }
          return new Response(
            JSON.stringify({
              status: 'ok',
              service: 'api-v2',
              version: '1.0.0'
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        if (url.endsWith('/connect/tearleads.v1.AuthService/RefreshToken')) {
          return new Response(
            JSON.stringify({
              accessToken: 'fresh-token',
              refreshToken: 'fresh-refresh-token',
              tokenType: 'Bearer',
              expiresIn: 3600,
              refreshExpiresIn: 604800,
              user: { id: 'user-1', email: 'user@example.com' }
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      }
    );

    const { api, setApiRequestHeadersProvider } = await import('./api');
    setApiRequestHeadersProvider(() => ({
      'X-Organization-Id': 'org-123'
    }));

    await expect(api.ping.get()).resolves.toEqual({
      status: 'ok',
      service: 'api-v2',
      version: '1.0.0'
    });

    expect(seenOrgHeaders).toEqual(['org-123', 'org-123']);
  });

  it('does not override an explicit header passed in fetch options', async () => {
    vi.mocked(global.fetch).mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get('X-Organization-Id')).toBe('org-explicit');
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    );

    const { request, setApiRequestHeadersProvider } = await import('./apiCore');
    setApiRequestHeadersProvider(() => ({
      'X-Organization-Id': 'org-provider'
    }));

    await expect(
      request<{ ok: boolean }>('/v2/ping', {
        fetchOptions: {
          headers: {
            'X-Organization-Id': 'org-explicit'
          }
        },
        eventName: 'api_get_ping'
      })
    ).resolves.toEqual({ ok: true });
  });

  it('rejects VFS write requests without declared organization header', async () => {
    const { request, resetApiRequestHeadersProvider } = await import(
      './apiCore'
    );
    resetApiRequestHeadersProvider();

    await expect(
      request<{ ok: boolean }>('/connect/tearleads.v1.VfsService/PushCrdtOps', {
        fetchOptions: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        },
        eventName: 'api_get_ping'
      })
    ).rejects.toThrow(/X-Organization-Id header is required/u);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('allows VFS write requests when organization header is declared', async () => {
    vi.mocked(global.fetch).mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get('X-Organization-Id')).toBe('org-explicit');
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    );

    const { request, resetApiRequestHeadersProvider } = await import(
      './apiCore'
    );
    resetApiRequestHeadersProvider();

    await expect(
      request<{ ok: boolean }>('/connect/tearleads.v1.VfsService/PushCrdtOps', {
        fetchOptions: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Organization-Id': 'org-explicit'
          },
          body: JSON.stringify({})
        },
        eventName: 'api_get_ping'
      })
    ).resolves.toEqual({ ok: true });
  });
});
