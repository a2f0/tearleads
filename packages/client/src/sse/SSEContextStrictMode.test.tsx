import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import { SSEProvider, useSSE } from './SSEContext';
import {
  createMockFetch,
  mockIsJwtExpired,
  mockSSE,
  mockTryRefreshToken,
  type OpenNotificationStreamOptions
} from './SSEContextTestSupport';

const mockApiModule = vi.hoisted(() => ({
  API_BASE_URL: 'http://localhost:5001/v1',
  tryRefreshToken: () => mockTryRefreshToken(),
  openNotificationEventStream: (options: OpenNotificationStreamOptions) =>
    mockSSE.openNotificationEventStream(options)
}));

vi.mock('@/lib/api', () => mockApiModule);
vi.mock('@/lib/jwt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jwt')>();
  return {
    ...actual,
    isJwtExpired: (token: string) => mockIsJwtExpired(token)
  };
});

describe('SSEContext strict mode lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSSE.reset();
    mockSSE.fetchMock = createMockFetch();
    vi.stubGlobal('fetch', mockSSE.fetchMock);
    localStorage.setItem('auth_token', 'test-token');
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'test@example.com' })
    );
    mockIsJwtExpired.mockReturnValue(false);
    mockTryRefreshToken.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  async function flushAuthLoad() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  function strictAutoConnectWrapper({ children }: { children: ReactNode }) {
    return (
      <StrictMode>
        <AuthProvider>
          <SSEProvider>{children}</SSEProvider>
        </AuthProvider>
      </StrictMode>
    );
  }

  it('keeps at most one active stream during strict-mode remounts', async () => {
    const { result, unmount } = renderHook(() => useSSE(), {
      wrapper: strictAutoConnectWrapper
    });

    await flushAuthLoad();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(mockSSE.connections.length).toBeGreaterThanOrEqual(1);
    const activeConnections = mockSSE.connections.filter(
      (connection) => !connection.reader.aborted
    );
    expect(activeConnections).toHaveLength(1);
    expect(result.current.connectionState).toBe('connecting');

    unmount();

    expect(
      mockSSE.connections.every((connection) => connection.reader.aborted)
    ).toBe(true);
  });
});
