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

  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AuthProvider>
        <SSEProvider autoConnect={false}>{children}</SSEProvider>
      </AuthProvider>
    );
  }

  function autoConnectWrapper({ children }: { children: React.ReactNode }) {
    return (
      <AuthProvider>
        <SSEProvider>{children}</SSEProvider>
      </AuthProvider>
    );
  }

  describe('SSEProvider', () => {
    it('starts disconnected when autoConnect is false', async () => {
      const { result } = renderHook(() => useSSE(), { wrapper });

      await flushAuthLoad();
      expect(result.current.connectionState).toBe('disconnected');
    });

    it('auto-connects when autoConnect is true', async () => {
      const { result } = renderHook(() => useSSE(), {
        wrapper: autoConnectWrapper
      });

      await flushAuthLoad();
      expect(result.current.connectionState).toBe('connecting');
      expect(mockSSE.connections).toHaveLength(1);
    });

    it('transitions to connected on connected event', async () => {
      const { result } = renderHook(() => useSSE(), {
        wrapper: autoConnectWrapper
      });

      await flushAuthLoad();

      await act(async () => {
        mockSSE.getInstance(0).emit('connected');
        await vi.advanceTimersByTimeAsync(50);
      });

      expect(result.current.connectionState).toBe('connected');
    });

    it('disconnects when user logs out', async () => {
      const { result } = renderHook(() => useSSE(), {
        wrapper: autoConnectWrapper
      });

      await flushAuthLoad();

      await act(async () => {
        mockSSE.getInstance(0).emit('connected');
        await vi.advanceTimersByTimeAsync(50);
      });

      expect(result.current.connectionState).toBe('connected');

      // Simulate logout: clear auth from localStorage and notify
      await act(async () => {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        window.dispatchEvent(new Event('tearleads_auth_change'));
        await vi.advanceTimersByTimeAsync(50);
      });

      expect(result.current.connectionState).toBe('disconnected');
      expect(mockSSE.getInstance(0).reader.aborted).toBe(true);
    });

    it('does not auto-connect when not authenticated', async () => {
      localStorage.clear();

      const { result } = renderHook(() => useSSE(), {
        wrapper: autoConnectWrapper
      });

      await flushAuthLoad();
      expect(result.current.connectionState).toBe('disconnected');
      expect(mockSSE.connections).toHaveLength(0);
    });
  });
});
