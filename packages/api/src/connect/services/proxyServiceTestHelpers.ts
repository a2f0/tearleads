import { afterEach, beforeEach, expect, vi } from 'vitest';

export type TestContext = {
  requestHeader: Headers;
};

export function createTestContext(): TestContext {
  return {
    requestHeader: new Headers({
      host: '127.0.0.1:55661',
      authorization: 'Bearer token-1',
      'x-organization-id': 'org-1'
    })
  };
}

export function useProxyFetchMock() {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NODE_ENV', 'test');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function mockJsonResponse(body = '{"ok":true}'): void {
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    );
  }

  function expectLastFetch(url: string, method: string, body?: string): void {
    const [actualUrl, init] = fetchMock.mock.calls.at(-1) ?? [];
    expect(actualUrl).toBe(url);
    expect(init?.method).toBe(method);

    const headers = init?.headers;
    expect(headers).toBeInstanceOf(Headers);
    if (!(headers instanceof Headers)) {
      throw new Error('Expected Headers instance');
    }
    expect(headers.get('authorization')).toBe('Bearer token-1');
    expect(headers.get('x-organization-id')).toBe('org-1');

    if (body !== undefined) {
      expect(init?.body).toBe(body);
      expect(headers.get('content-type')).toBe('application/json');
    }
  }

  return {
    fetchMock,
    mockJsonResponse,
    expectLastFetch
  };
}
