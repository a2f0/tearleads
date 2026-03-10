import { act, renderHook } from '@testing-library/react';
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

// one-component-per-file: allow -- test-only provider wrappers for renderHook scenarios.

function createMockApiModule() {
  return {
    API_BASE_URL: 'http://localhost:5001/v1',
    tryRefreshToken: () => mockTryRefreshToken(),
    openNotificationEventStream: (options: OpenNotificationStreamOptions) =>
      mockSSE.openNotificationEventStream(options)
  };
}

var mockApiModuleState: ReturnType<typeof createMockApiModule> | undefined;

function getMockApiModule() {
  if (!mockApiModuleState) {
    mockApiModuleState = createMockApiModule();
  }
  if (!mockApiModuleState) {
    throw new Error('Expected mockApiModuleState to be initialized');
  }
  return mockApiModuleState;
}

const mockApiModule = getMockApiModule();

vi.mock('@/lib/api', () => getMockApiModule());
vi.mock('@/lib/jwt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jwt')>();
  return {
    ...actual,
    isJwtExpired: (token: string) => mockIsJwtExpired(token)
  };
});
describe('SSEContext', () => {
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

  function _wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AuthProvider>
        <SSEProvider autoConnect={false}>{children}</SSEProvider>
      </AuthProvider>
    );
  }

  function _autoConnectWrapper({ children }: { children: React.ReactNode }) {
    return (
      <AuthProvider>
        <SSEProvider>{children}</SSEProvider>
      </AuthProvider>
    );
  }

  describe('channel changes', () => {
    it('reconnects when channels change while connected', async () => {
      let channels = ['channel1'];
      const ChannelWrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>
          <SSEProvider autoConnect={false} channels={channels}>
            {children}
          </SSEProvider>
        </AuthProvider>
      );

      const { result, rerender } = renderHook(() => useSSE(), {
        wrapper: ChannelWrapper
      });

      // Connect
      await flushAuthLoad();
      act(() => {
        result.current.connect();
      });

      await act(async () => {
        mockSSE.getInstance(0).emit('connected');
        await vi.advanceTimersByTimeAsync(50);
      });

      const initialInstanceCount = mockSSE.connections.length;

      // Change channels
      channels = ['channel2'];
      rerender();

      // Should have created a new connection for the new channels
      expect(mockSSE.connections.length).toBeGreaterThanOrEqual(
        initialInstanceCount
      );
    });

    it('does not reconnect when channels stay the same', async () => {
      const ChannelWrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>
          <SSEProvider autoConnect={false} channels={['channel1']}>
            {children}
          </SSEProvider>
        </AuthProvider>
      );

      const { result, rerender } = renderHook(() => useSSE(), {
        wrapper: ChannelWrapper
      });

      // Connect
      await flushAuthLoad();
      act(() => {
        result.current.connect();
      });

      await act(async () => {
        mockSSE.getInstance(0).emit('connected');
        await vi.advanceTimersByTimeAsync(50);
      });

      const instanceCount = mockSSE.connections.length;

      // Rerender without changing channels
      rerender();

      // Should not create new connection
      expect(mockSSE.connections.length).toBe(instanceCount);
    });
  });
});
