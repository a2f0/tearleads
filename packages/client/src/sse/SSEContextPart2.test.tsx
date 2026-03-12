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
  return mockApiModuleState;
}

vi.mock('@/lib/api', () => getMockApiModule());
vi.mock('@/lib/jwt', async () => {
  const { createJwtModuleMock } = await import('./SSEContextTestSupport');
  return createJwtModuleMock();
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

  function _autoConnectWrapper({ children }: { children: React.ReactNode }) {
    return (
      <AuthProvider>
        <SSEProvider>{children}</SSEProvider>
      </AuthProvider>
    );
  }

  describe('useSSE', () => {
    it('throws error when used outside SSEProvider', () => {
      expect(() => {
        renderHook(() => useSSE());
      }).toThrow('useSSE must be used within an SSEProvider');
    });

    describe('connect', () => {
      it('does nothing when token is null', async () => {
        localStorage.clear();

        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        act(() => {
          result.current.connect();
        });

        expect(mockSSE.connections).toHaveLength(0);
        expect(result.current.connectionState).toBe('disconnected');
      });

      it('creates fetch with correct URL and Authorization header', async () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        act(() => {
          result.current.connect();
        });

        expect(mockSSE.connections).toHaveLength(1);
        expect(mockSSE.fetchMock).toHaveBeenCalledWith(
          'http://localhost:5001/v1/sse?channels=broadcast',
          expect.objectContaining({
            headers: { Authorization: 'Bearer test-token' }
          })
        );
      });

      it('sets state to connecting', async () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        act(() => {
          result.current.connect();
        });

        expect(result.current.connectionState).toBe('connecting');
      });

      it('connects with custom channels', async () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        act(() => {
          result.current.connect(['channel1', 'channel2']);
        });

        expect(mockSSE.fetchMock).toHaveBeenCalledWith(
          'http://localhost:5001/v1/sse?channels=channel1%2Cchannel2',
          expect.any(Object)
        );
      });
    });

    describe('disconnect', () => {
      it('sets state to disconnected', async () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        act(() => {
          result.current.connect();
        });

        await act(async () => {
          mockSSE.getInstance(0).emit('connected');
          await vi.advanceTimersByTimeAsync(50);
        });

        act(() => {
          result.current.disconnect();
        });

        expect(result.current.connectionState).toBe('disconnected');
      });
    });

    describe('messages', () => {
      it('updates lastMessage on message event', async () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        act(() => {
          result.current.connect();
        });

        await act(async () => {
          mockSSE.getInstance(0).emit('connected');
          await vi.advanceTimersByTimeAsync(50);
        });

        const testMessage = {
          type: 'test',
          payload: { data: 'hello' },
          timestamp: '2026-01-10T00:00:00.000Z'
        };

        await act(async () => {
          mockSSE
            .getInstance(0)
            .emit(
              'message',
              JSON.stringify({ channel: 'test', message: testMessage })
            );
          await vi.advanceTimersByTimeAsync(50);
        });

        expect(result.current.lastMessage).toEqual({
          channel: 'test',
          message: testMessage
        });
      });

      it('handles invalid JSON gracefully', async () => {
        const consoleSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {});
        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        act(() => {
          result.current.connect();
        });

        await act(async () => {
          mockSSE.getInstance(0).emit('message', 'invalid json');
          await vi.advanceTimersByTimeAsync(50);
        });

        expect(result.current.lastMessage).toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith(
          'Failed to parse SSE message:',
          expect.any(Error)
        );
        consoleSpy.mockRestore();
      });

      it('handles message with missing type in message object', async () => {
        const consoleSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {});
        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        act(() => {
          result.current.connect();
        });

        await act(async () => {
          mockSSE.getInstance(0).emit(
            'message',
            JSON.stringify({
              channel: 'test',
              message: { payload: {}, timestamp: '2026-01-10T00:00:00.000Z' }
            })
          );
          await vi.advanceTimersByTimeAsync(50);
        });

        expect(result.current.lastMessage).toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith(
          'Failed to parse SSE message: invalid shape',
          expect.any(Object)
        );
        consoleSpy.mockRestore();
      });

      it('handles message with missing payload in message object', async () => {
        const consoleSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {});
        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        act(() => {
          result.current.connect();
        });

        await act(async () => {
          mockSSE.getInstance(0).emit(
            'message',
            JSON.stringify({
              channel: 'test',
              message: { type: 'test', timestamp: '2026-01-10T00:00:00.000Z' }
            })
          );
          await vi.advanceTimersByTimeAsync(50);
        });

        expect(result.current.lastMessage).toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith(
          'Failed to parse SSE message: invalid shape',
          expect.any(Object)
        );
        consoleSpy.mockRestore();
      });
    });

    describe('auto-reconnect', () => {
      it('reconnects with exponential backoff on error', async () => {
        mockSSE.fetchMock = vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            body: {
              getReader: () => {
                const connection = mockSSE.createConnection();
                // Emit connected then close to trigger reconnect
                setTimeout(() => {
                  connection.emit('connected');
                  setTimeout(() => {
                    connection.close();
                  }, 10);
                }, 10);
                return connection.reader;
              }
            }
          })
          .mockImplementation(() => {
            const connection = mockSSE.createConnection();
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

        // Wait for connection and disconnect
        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });

        expect(result.current.connectionState).toBe('disconnected');

        // First reconnect after 1s
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });

        expect(mockSSE.connections).toHaveLength(2);
        expect(result.current.connectionState).toBe('connecting');
      });
    });

    describe('initial state', () => {
      it('has disconnected connection state', async () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        expect(result.current.connectionState).toBe('disconnected');
      });

      it('has null lastMessage', async () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        expect(result.current.lastMessage).toBeNull();
      });
    });
  });
});
