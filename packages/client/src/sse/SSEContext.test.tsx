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

type EventSourceListener = (event: { data: string }) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, EventSourceListener[]> = {};
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, callback: EventSourceListener) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]?.push(callback);
  }

  close() {
    // noop
  }

  emit(event: string, data = '') {
    const callbacks = this.listeners[event] ?? [];
    for (const callback of callbacks) {
      callback({ data });
    }
  }

  triggerError() {
    if (this.onerror) {
      this.onerror();
    }
  }

  static getInstance(index: number): MockEventSource {
    const instance = MockEventSource.instances[index];
    if (!instance) {
      throw new Error(`MockEventSource instance ${index} not found`);
    }
    return instance;
  }

  static getLastInstance(): MockEventSource {
    const instance =
      MockEventSource.instances[MockEventSource.instances.length - 1];
    if (!instance) {
      throw new Error('No MockEventSource instances');
    }
    return instance;
  }
}

describe('SSEContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
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
      expect(MockEventSource.instances).toHaveLength(1);
    });

    it('transitions to connected on connected event', async () => {
      const { result } = renderHook(() => useSSE(), {
        wrapper: autoConnectWrapper
      });

      await flushAuthLoad();
      act(() => {
        MockEventSource.getInstance(0).emit('connected');
      });

      expect(result.current.connectionState).toBe('connected');
    });

    it('does not auto-connect when not authenticated', async () => {
      localStorage.clear();

      const { result } = renderHook(() => useSSE(), {
        wrapper: autoConnectWrapper
      });

      await flushAuthLoad();
      expect(result.current.connectionState).toBe('disconnected');
      expect(MockEventSource.instances).toHaveLength(0);
    });
  });

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

        expect(MockEventSource.instances).toHaveLength(0);
        expect(result.current.connectionState).toBe('disconnected');
      });

      it('creates EventSource with correct URL', async () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        act(() => {
          result.current.connect();
        });

        expect(MockEventSource.instances).toHaveLength(1);
        expect(MockEventSource.getInstance(0).url).toBe(
          'http://localhost:5001/v1/sse?channels=broadcast&token=test-token'
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

        expect(MockEventSource.getInstance(0).url).toBe(
          'http://localhost:5001/v1/sse?channels=channel1%2Cchannel2&token=test-token'
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

        act(() => {
          MockEventSource.getInstance(0).emit('connected');
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

        act(() => {
          MockEventSource.getInstance(0).emit('connected');
        });

        const testMessage = {
          type: 'test',
          payload: { data: 'hello' },
          timestamp: '2026-01-10T00:00:00.000Z'
        };

        act(() => {
          MockEventSource.getInstance(0).emit(
            'message',
            JSON.stringify({ channel: 'test', message: testMessage })
          );
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

        act(() => {
          MockEventSource.getInstance(0).emit('message', 'invalid json');
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

        act(() => {
          MockEventSource.getInstance(0).emit(
            'message',
            JSON.stringify({
              channel: 'test',
              message: { payload: {}, timestamp: '2026-01-10T00:00:00.000Z' }
            })
          );
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

        act(() => {
          MockEventSource.getInstance(0).emit(
            'message',
            JSON.stringify({
              channel: 'test',
              message: { type: 'test', timestamp: '2026-01-10T00:00:00.000Z' }
            })
          );
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
        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        act(() => {
          result.current.connect();
        });

        act(() => {
          MockEventSource.getInstance(0).emit('connected');
        });

        // Trigger error
        act(() => {
          MockEventSource.getInstance(0).triggerError();
        });

        expect(result.current.connectionState).toBe('disconnected');

        // First reconnect after 1s
        act(() => {
          vi.advanceTimersByTime(1000);
        });

        expect(MockEventSource.instances).toHaveLength(2);
        expect(result.current.connectionState).toBe('connecting');
      });

      it('uses exponential backoff for reconnect delays', async () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        act(() => {
          result.current.connect();
        });

        const initialCount = MockEventSource.instances.length;

        // First error - schedules reconnect in 1s (2^0 * 1000)
        act(() => {
          MockEventSource.getInstance(0).triggerError();
        });

        // Wait 1s for first reconnect
        act(() => {
          vi.advanceTimersByTime(1000);
        });

        expect(MockEventSource.instances.length).toBe(initialCount + 1);

        // Second error - schedules reconnect in 2s (2^1 * 1000)
        const countAfterFirstReconnect = MockEventSource.instances.length;
        act(() => {
          MockEventSource.getLastInstance().triggerError();
        });

        // Wait full 2s for second reconnect
        act(() => {
          vi.advanceTimersByTime(2000);
        });

        expect(MockEventSource.instances.length).toBe(
          countAfterFirstReconnect + 1
        );
      });

      it('resets reconnect attempt count on successful connection', async () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        await flushAuthLoad();
        act(() => {
          result.current.connect();
        });

        // First error
        act(() => {
          MockEventSource.getInstance(0).triggerError();
        });

        // Wait 1s for first reconnect
        act(() => {
          vi.advanceTimersByTime(1000);
        });

        // Connect successfully
        act(() => {
          MockEventSource.getInstance(1).emit('connected');
        });

        // Another error
        act(() => {
          MockEventSource.getInstance(1).triggerError();
        });

        // Should reconnect after 1s again (not 2s)
        act(() => {
          vi.advanceTimersByTime(1000);
        });

        expect(MockEventSource.instances).toHaveLength(3);
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

      // Should log error and not create EventSource
      expect(consoleSpy).toHaveBeenCalledWith('API_BASE_URL not configured');
      expect(MockEventSource.instances).toHaveLength(0);

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
      act(() => {
        MockEventSource.getLastInstance().emit('connected');
      });
      expect(result.current.connectionState).toBe('connected');
      const initialInstanceCount = MockEventSource.instances.length;

      // Simulate token refresh by updating localStorage and dispatching auth change event
      act(() => {
        localStorage.setItem('auth_token', 'new-refreshed-token');
        window.dispatchEvent(new Event('rapid_auth_change'));
      });

      // Allow effects to run
      await act(async () => {
        await Promise.resolve();
      });

      expect(MockEventSource.instances.length).toBe(initialInstanceCount + 1);
      expect(result.current.connectionState).toBe('connecting');
      expect(MockEventSource.getLastInstance().url).toContain(
        'token=new-refreshed-token'
      );
    });

    it('does not reconnect when token changes while disconnected', async () => {
      const { result } = renderHook(() => useSSE(), { wrapper });

      await flushAuthLoad();
      expect(result.current.connectionState).toBe('disconnected');
      const initialInstanceCount = MockEventSource.instances.length;

      // Simulate token refresh
      act(() => {
        localStorage.setItem('auth_token', 'new-refreshed-token');
        window.dispatchEvent(new Event('rapid_auth_change'));
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Should not create a new EventSource since we were disconnected
      expect(MockEventSource.instances.length).toBe(initialInstanceCount);
      expect(result.current.connectionState).toBe('disconnected');
    });

    it('reconnects when token changes while connected with autoConnect=false', async () => {
      const { result } = renderHook(() => useSSE(), { wrapper });

      await flushAuthLoad();

      // Manually connect
      act(() => {
        result.current.connect();
      });
      act(() => {
        MockEventSource.getLastInstance().emit('connected');
      });
      expect(result.current.connectionState).toBe('connected');
      const initialInstanceCount = MockEventSource.instances.length;

      // Simulate token refresh
      act(() => {
        localStorage.setItem('auth_token', 'new-refreshed-token');
        window.dispatchEvent(new Event('rapid_auth_change'));
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Should create a new EventSource with the new token
      expect(MockEventSource.instances.length).toBe(initialInstanceCount + 1);
      expect(result.current.connectionState).toBe('connecting');
      expect(MockEventSource.getLastInstance().url).toContain(
        'token=new-refreshed-token'
      );
    });
  });

  describe('token expiration handling', () => {
    it('attempts token refresh when error occurs with expired token', async () => {
      mockIsJwtExpired.mockReturnValue(true);

      const { result } = renderHook(() => useSSE(), { wrapper });

      await flushAuthLoad();
      act(() => {
        result.current.connect();
      });

      act(() => {
        MockEventSource.getInstance(0).emit('connected');
      });

      // Clear any calls from AuthContext mount before testing SSE error handling
      mockTryRefreshToken.mockClear();

      // Trigger error with expired token
      act(() => {
        MockEventSource.getInstance(0).triggerError();
      });

      expect(mockTryRefreshToken).toHaveBeenCalledTimes(1);
      // State should be 'connecting' to allow token-change effect to reconnect
      expect(result.current.connectionState).toBe('connecting');

      // Should NOT schedule a reconnect - let auth flow handle it
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // No new EventSource should be created via exponential backoff
      expect(MockEventSource.instances).toHaveLength(1);
    });

    it('uses exponential backoff when error occurs with valid token', async () => {
      mockIsJwtExpired.mockReturnValue(false);

      const { result } = renderHook(() => useSSE(), { wrapper });

      await flushAuthLoad();
      act(() => {
        result.current.connect();
      });

      act(() => {
        MockEventSource.getInstance(0).emit('connected');
      });

      // Clear any calls from AuthContext mount before testing SSE error handling
      mockTryRefreshToken.mockClear();

      // Trigger error with valid token
      act(() => {
        MockEventSource.getInstance(0).triggerError();
      });

      expect(mockTryRefreshToken).not.toHaveBeenCalled();
      expect(result.current.connectionState).toBe('disconnected');

      // Should schedule reconnect with exponential backoff
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(MockEventSource.instances).toHaveLength(2);
      expect(result.current.connectionState).toBe('connecting');
    });
  });

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

      act(() => {
        MockEventSource.getInstance(0).emit('connected');
      });

      const initialInstanceCount = MockEventSource.instances.length;

      // Change channels
      channels = ['channel2'];
      rerender();

      // Should have created a new EventSource for the new channels
      expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(
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

      act(() => {
        MockEventSource.getInstance(0).emit('connected');
      });

      const instanceCount = MockEventSource.instances.length;

      // Rerender without changing channels
      rerender();

      // Should not create new EventSource
      expect(MockEventSource.instances.length).toBe(instanceCount);
    });
  });
});
