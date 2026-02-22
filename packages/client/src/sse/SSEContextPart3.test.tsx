import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import { SSEProvider, useSSE, useSSEContext } from './SSEContext';

const mockTryRefreshToken = vi.fn().mockResolvedValue(false);
const mockIsJwtExpired = vi.fn().mockReturnValue(false);

const mockApiModule = vi.hoisted(() => ({
  API_BASE_URL: 'http://localhost:5001/v1',
  tryRefreshToken: () => mockTryRefreshToken()
}));

vi.mock('@/lib/api', () => mockApiModule);
vi.mock('@/lib/jwt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jwt')>();
  return {
    ...actual,
    isJwtExpired: (token: string) => mockIsJwtExpired(token)
  };
});

interface MockReader {
  chunks: string[];
  chunkIndex: number;
  aborted: boolean;
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
}

interface MockSSEConnection {
  reader: MockReader;
  abortController: AbortController;
  emit: (event: string, data?: string) => void;
  close: () => void;
}

const mockSSE = {
  connections: [] as MockSSEConnection[],
  fetchMock: null as ReturnType<typeof vi.fn> | null,

  reset() {
    mockSSE.connections = [];
  },

  createConnection(): MockSSEConnection {
    const encoder = new TextEncoder();
    const abortController = new AbortController();

    const reader: MockReader = {
      chunks: [],
      chunkIndex: 0,
      aborted: false,
      read: async function () {
        if (this.aborted) {
          return { done: true };
        }

        // Wait for chunks to be added
        while (this.chunkIndex >= this.chunks.length && !this.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        if (this.aborted) {
          return { done: true };
        }

        const chunk = this.chunks[this.chunkIndex];
        this.chunkIndex++;
        return { done: false, value: encoder.encode(chunk) };
      }
    };

    const connection: MockSSEConnection = {
      reader,
      abortController,
      emit: (event: string, data = '') => {
        let chunk = `event: ${event}\n`;
        if (data) {
          chunk += `data: ${data}\n`;
        }
        chunk += '\n';
        reader.chunks.push(chunk);
      },
      close: () => {
        reader.aborted = true;
      }
    };

    mockSSE.connections.push(connection);
    return connection;
  },

  getInstance(index: number): MockSSEConnection {
    const connection = mockSSE.connections[index];
    if (!connection) {
      throw new Error(`MockSSEConnection instance ${index} not found`);
    }
    return connection;
  },

  getLastInstance(): MockSSEConnection {
    const connection = mockSSE.connections[mockSSE.connections.length - 1];
    if (!connection) {
      throw new Error('No MockSSEConnection instances');
    }
    return connection;
  }
};

function createMockFetch() {
  return vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
    const connection = mockSSE.createConnection();

    // Handle abort signal
    if (options?.signal) {
      options.signal.addEventListener('abort', () => {
        connection.close();
      });
    }

    return Promise.resolve({
      ok: true,
      body: {
        getReader: () => connection.reader
      }
    });
  });
}

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

  describe('useSSEContext', () => {
    it('returns null when used outside SSEProvider', () => {
      const { result } = renderHook(() => useSSEContext());

      expect(result.current).toBeNull();
    });

    it('returns context when used inside SSEProvider', async () => {
      const { result } = renderHook(() => useSSEContext(), { wrapper });

      await flushAuthLoad();
      expect(result.current).not.toBeNull();
      expect(result.current?.connectionState).toBe('disconnected');
    });
  });

  describe('API_BASE_URL not configured', () => {
    it('does nothing when API_BASE_URL is empty', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Temporarily clear API_BASE_URL
      const originalUrl = mockApiModule.API_BASE_URL;
      mockApiModule.API_BASE_URL = '';

      const { result } = renderHook(() => useSSE(), { wrapper });

      await flushAuthLoad();
      act(() => {
        result.current.connect();
      });

      // Should log error and not create fetch
      expect(consoleSpy).toHaveBeenCalledWith('API_BASE_URL not configured');
      expect(mockSSE.connections).toHaveLength(0);

      // Restore
      mockApiModule.API_BASE_URL = originalUrl;
      consoleSpy.mockRestore();
    });
  });

  describe('token refresh', () => {
    it('reconnects when token changes while connected', async () => {
      const { result } = renderHook(() => useSSE(), {
        wrapper: autoConnectWrapper
      });

      await flushAuthLoad();
      await act(async () => {
        mockSSE.getLastInstance().emit('connected');
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(result.current.connectionState).toBe('connected');
      const initialInstanceCount = mockSSE.connections.length;

      // Simulate token refresh by updating localStorage and dispatching auth change event
      act(() => {
        localStorage.setItem('auth_token', 'new-refreshed-token');
        window.dispatchEvent(new Event('tearleads_auth_change'));
      });

      // Allow effects to run
      await act(async () => {
        await Promise.resolve();
      });

      expect(mockSSE.connections.length).toBe(initialInstanceCount + 1);
      expect(result.current.connectionState).toBe('connecting');
      expect(mockSSE.fetchMock).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { Authorization: 'Bearer new-refreshed-token' }
        })
      );
    });

    it('does not reconnect when token changes while disconnected', async () => {
      const { result } = renderHook(() => useSSE(), { wrapper });

      await flushAuthLoad();
      expect(result.current.connectionState).toBe('disconnected');
      const initialInstanceCount = mockSSE.connections.length;

      // Simulate token refresh
      act(() => {
        localStorage.setItem('auth_token', 'new-refreshed-token');
        window.dispatchEvent(new Event('tearleads_auth_change'));
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Should not create a new connection since we were disconnected
      expect(mockSSE.connections.length).toBe(initialInstanceCount);
      expect(result.current.connectionState).toBe('disconnected');
    });

    it('reconnects when token changes while connected with autoConnect=false', async () => {
      const { result } = renderHook(() => useSSE(), { wrapper });

      await flushAuthLoad();

      // Manually connect
      act(() => {
        result.current.connect();
      });
      await act(async () => {
        mockSSE.getLastInstance().emit('connected');
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(result.current.connectionState).toBe('connected');
      const initialInstanceCount = mockSSE.connections.length;

      // Simulate token refresh
      act(() => {
        localStorage.setItem('auth_token', 'new-refreshed-token');
        window.dispatchEvent(new Event('tearleads_auth_change'));
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Should create a new connection with the new token
      expect(mockSSE.connections.length).toBe(initialInstanceCount + 1);
      expect(result.current.connectionState).toBe('connecting');
      expect(mockSSE.fetchMock).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { Authorization: 'Bearer new-refreshed-token' }
        })
      );
    });
  });

  describe('token expiration handling', () => {
    it('attempts token refresh when stream ends with expired token', async () => {
      mockIsJwtExpired.mockReturnValue(true);

      mockSSE.fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => {
            const connection = mockSSE.createConnection();
            // Emit connected then close to trigger error handling
            setTimeout(() => {
              connection.emit('connected');
              setTimeout(() => {
                connection.close();
              }, 10);
            }, 10);
            return connection.reader;
          }
        }
      });

      vi.stubGlobal('fetch', mockSSE.fetchMock);

      const { result } = renderHook(() => useSSE(), { wrapper });

      await flushAuthLoad();
      act(() => {
        result.current.connect();
      });

      // Clear any calls from AuthContext mount before testing SSE error handling
      mockTryRefreshToken.mockClear();

      // Wait for connection and disconnect
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockTryRefreshToken).toHaveBeenCalledTimes(1);
      // State should be 'connecting' to allow token-change effect to reconnect
      expect(result.current.connectionState).toBe('connecting');
    });

    it('uses exponential backoff when stream ends with valid token', async () => {
      mockIsJwtExpired.mockReturnValue(false);

      let connectionCount = 0;
      mockSSE.fetchMock = vi.fn().mockImplementation(() => {
        connectionCount++;
        const connection = mockSSE.createConnection();
        // First connection: emit connected then close to trigger reconnect
        if (connectionCount === 1) {
          setTimeout(() => {
            connection.emit('connected');
            setTimeout(() => {
              connection.close();
            }, 10);
          }, 10);
        }
        return Promise.resolve({
          ok: true,
          body: { getReader: () => connection.reader }
        });
      });

      vi.stubGlobal('fetch', mockSSE.fetchMock);

      const { result } = renderHook(() => useSSE(), { wrapper });

      await flushAuthLoad();
      act(() => {
        result.current.connect();
      });

      // Clear any calls from AuthContext mount before testing SSE error handling
      mockTryRefreshToken.mockClear();

      // Wait for connection and disconnect
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockTryRefreshToken).not.toHaveBeenCalled();
      expect(result.current.connectionState).toBe('disconnected');
      expect(connectionCount).toBe(1);

      // Should schedule reconnect with exponential backoff (1s delay)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      // Verify a second connection was made
      expect(connectionCount).toBe(2);
      expect(result.current.connectionState).toBe('connecting');
    });
  });
});
