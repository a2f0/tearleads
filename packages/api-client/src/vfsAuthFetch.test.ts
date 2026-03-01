import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithAuthRefresh } from './vfsAuthFetch';

const tryRefreshTokenMock = vi.fn();
const getAuthHeaderValueMock = vi.fn();

vi.mock('./apiCore', () => ({
  tryRefreshToken: () => tryRefreshTokenMock()
}));

vi.mock('./authStorage', () => ({
  getAuthHeaderValue: () => getAuthHeaderValueMock()
}));

function getAuthorizationHeader(init: RequestInit | undefined): string | null {
  if (!init || !init.headers) {
    return null;
  }
  return new Headers(init.headers).get('Authorization');
}

describe('fetchWithAuthRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves explicit Authorization header and skips auth storage lookup', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

    await fetchWithAuthRefresh(fetchMock, 'https://example.test/v1/resource', {
      headers: {
        Authorization: 'Bearer explicit-token'
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCallInit = fetchMock.mock.calls[0]?.[1];
    expect(getAuthorizationHeader(firstCallInit)).toBe('Bearer explicit-token');
    expect(getAuthHeaderValueMock).not.toHaveBeenCalled();
  });

  it('returns first 401 response when refresh fails', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    getAuthHeaderValueMock.mockReturnValue('Bearer stored-token');
    tryRefreshTokenMock.mockResolvedValue(false);

    const response = await fetchWithAuthRefresh(
      fetchMock,
      'https://example.test/v1/resource'
    );

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAuthorizationHeader(fetchMock.mock.calls[0]?.[1])).toBe(
      'Bearer stored-token'
    );
    expect(tryRefreshTokenMock).toHaveBeenCalledTimes(1);
  });

  it('retries once after successful refresh', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    getAuthHeaderValueMock.mockReturnValue(null);
    tryRefreshTokenMock.mockResolvedValue(true);

    const response = await fetchWithAuthRefresh(
      fetchMock,
      'https://example.test/v1/resource'
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getAuthorizationHeader(fetchMock.mock.calls[0]?.[1])).toBeNull();
    expect(getAuthorizationHeader(fetchMock.mock.calls[1]?.[1])).toBeNull();
  });
});
