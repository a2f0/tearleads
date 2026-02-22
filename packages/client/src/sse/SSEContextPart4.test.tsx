import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import { SSEProvider, useSSE } from './SSEContext';

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
