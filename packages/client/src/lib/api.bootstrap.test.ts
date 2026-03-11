import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('api bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('@tearleads/api-client/clientEntry');
    vi.doUnmock('@/db/analytics');
  });

  it('forwards client entry exports and wires bootstrap hooks', async () => {
    const apiMock = { ping: { get: vi.fn() } };
    const tryRefreshTokenMock = vi.fn(async () => false);
    const setApiEventLogger = vi.fn();
    const setApiRequestHeadersProvider = vi.fn();
    const logApiEvent = vi.fn(async () => undefined);

    vi.doMock('@tearleads/api-client/clientEntry', () => ({
      API_BASE_URL: 'http://mock-api',
      api: apiMock,
      tryRefreshToken: tryRefreshTokenMock,
      setApiEventLogger,
      setApiRequestHeadersProvider
    }));
    vi.doMock('@/db/analytics', () => ({
      logApiEvent
    }));

    const module = await import('./api');
    const orgStorage = await import('@/lib/orgStorage');

    expect(module.API_BASE_URL).toBe('http://mock-api');
    expect(module.api).toBe(apiMock);
    expect(module.tryRefreshToken).toBe(tryRefreshTokenMock);
    expect(setApiEventLogger).toHaveBeenCalledWith(logApiEvent);
    expect(setApiRequestHeadersProvider).toHaveBeenCalledTimes(1);

    const provider = setApiRequestHeadersProvider.mock.calls[0]?.[0];
    expect(typeof provider).toBe('function');
    if (typeof provider !== 'function') {
      return;
    }

    expect(provider()).toBeUndefined();

    orgStorage.setActiveOrganizationId('org-coverage');
    expect(provider()).toEqual({
      'X-Organization-Id': 'org-coverage'
    });

    orgStorage.clearActiveOrganizationId();
    expect(provider()).toBeUndefined();
  });
});
