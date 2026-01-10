import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SSEProvider, useSSE, useSSEContext } from './SSEContext';

vi.mock('@/lib/api', () => ({
  API_BASE_URL: 'http://localhost:5001/v1'
}));

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
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    return <SSEProvider autoConnect={false}>{children}</SSEProvider>;
  }

  function autoConnectWrapper({ children }: { children: React.ReactNode }) {
    return <SSEProvider>{children}</SSEProvider>;
  }

  describe('SSEProvider', () => {
    it('starts disconnected when autoConnect is false', () => {
      const { result } = renderHook(() => useSSE(), { wrapper });

      expect(result.current.connectionState).toBe('disconnected');
    });

    it('auto-connects when autoConnect is true', () => {
      const { result } = renderHook(() => useSSE(), {
        wrapper: autoConnectWrapper
      });

      expect(result.current.connectionState).toBe('connecting');
      expect(MockEventSource.instances).toHaveLength(1);
    });

    it('transitions to connected on connected event', () => {
      const { result } = renderHook(() => useSSE(), {
        wrapper: autoConnectWrapper
      });

      act(() => {
        MockEventSource.getInstance(0).emit('connected');
      });

      expect(result.current.connectionState).toBe('connected');
    });
  });

  describe('useSSE', () => {
    it('throws error when used outside SSEProvider', () => {
      expect(() => {
        renderHook(() => useSSE());
      }).toThrow('useSSE must be used within an SSEProvider');
    });

    describe('connect', () => {
      it('creates EventSource with correct URL', () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        act(() => {
          result.current.connect();
        });

        expect(MockEventSource.instances).toHaveLength(1);
        expect(MockEventSource.getInstance(0).url).toBe(
          'http://localhost:5001/v1/sse?channels=broadcast'
        );
      });

      it('sets state to connecting', () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        act(() => {
          result.current.connect();
        });

        expect(result.current.connectionState).toBe('connecting');
      });

      it('connects with custom channels', () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        act(() => {
          result.current.connect(['channel1', 'channel2']);
        });

        expect(MockEventSource.getInstance(0).url).toBe(
          'http://localhost:5001/v1/sse?channels=channel1%2Cchannel2'
        );
      });
    });

    describe('disconnect', () => {
      it('sets state to disconnected', () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

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
      it('updates lastMessage on message event', () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        act(() => {
          result.current.connect();
        });

        act(() => {
          MockEventSource.getInstance(0).emit('connected');
        });

        act(() => {
          MockEventSource.getInstance(0).emit(
            'message',
            JSON.stringify({ channel: 'test', message: 'hello' })
          );
        });

        expect(result.current.lastMessage).toEqual({
          channel: 'test',
          message: 'hello'
        });
      });

      it('handles invalid JSON gracefully', () => {
        const consoleSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {});
        const { result } = renderHook(() => useSSE(), { wrapper });

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
    });

    describe('auto-reconnect', () => {
      it('reconnects with exponential backoff on error', () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

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

      it('uses exponential backoff for reconnect delays', () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

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

      it('resets reconnect attempt count on successful connection', () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

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
      it('has disconnected connection state', () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        expect(result.current.connectionState).toBe('disconnected');
      });

      it('has null lastMessage', () => {
        const { result } = renderHook(() => useSSE(), { wrapper });

        expect(result.current.lastMessage).toBeNull();
      });
    });
  });

  describe('useSSEContext', () => {
    it('returns null when used outside SSEProvider', () => {
      const { result } = renderHook(() => useSSEContext());

      expect(result.current).toBeNull();
    });

    it('returns context when used inside SSEProvider', () => {
      const { result } = renderHook(() => useSSEContext(), { wrapper });

      expect(result.current).not.toBeNull();
      expect(result.current?.connectionState).toBe('disconnected');
    });
  });
});
