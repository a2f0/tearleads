import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before importing
vi.mock('./lib/redis.js', () => ({
  closeRedisClient: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('./lib/redisPubSub.js', () => ({
  closeRedisSubscriberClient: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('./lib/postgres.js', () => ({
  closePostgresPool: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('./routes/sse.js', async () => {
  const { Router } = await import('express');
  return {
    closeAllSSEConnections: vi.fn(),
    sseRouter: Router()
  };
});

// Import after mocking
const { gracefulShutdown, resetShutdownState } = await import('./index.js');
const { closeRedisClient } = await import('./lib/redis.js');
const { closeRedisSubscriberClient } = await import('./lib/redisPubSub.js');
const { closePostgresPool } = await import('./lib/postgres.js');
const { closeAllSSEConnections } = await import('./routes/sse.js');

describe('gracefulShutdown', () => {
  let mockServer: Server;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let closeCallback: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetShutdownState();

    mockServer = {
      close: vi.fn((callback: () => void) => {
        closeCallback = callback;
      })
    } as unknown as Server;

    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      return undefined as never;
    });

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    mockExit.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    closeCallback = null;
  });

  it('logs the signal received', async () => {
    await gracefulShutdown(mockServer, 'SIGTERM');

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '\nSIGTERM received, starting graceful shutdown...'
    );
  });

  it('closes all SSE connections', async () => {
    await gracefulShutdown(mockServer, 'SIGTERM');

    expect(closeAllSSEConnections).toHaveBeenCalled();
  });

  it('closes the HTTP server', async () => {
    await gracefulShutdown(mockServer, 'SIGTERM');

    expect(mockServer.close).toHaveBeenCalled();
  });

  it('closes Redis connections when server closes', async () => {
    await gracefulShutdown(mockServer, 'SIGTERM');

    expect(closeCallback).not.toBeNull();
    await closeCallback?.();

    expect(closeRedisClient).toHaveBeenCalled();
    expect(closeRedisSubscriberClient).toHaveBeenCalled();
    expect(closePostgresPool).toHaveBeenCalled();
  });

  it('exits with code 0 on successful shutdown', async () => {
    await gracefulShutdown(mockServer, 'SIGTERM');
    await closeCallback?.();

    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('prevents multiple shutdown attempts', async () => {
    await gracefulShutdown(mockServer, 'SIGTERM');
    await gracefulShutdown(mockServer, 'SIGINT');

    expect(mockServer.close).toHaveBeenCalledTimes(1);
  });

  it('forces exit after timeout', async () => {
    await gracefulShutdown(mockServer, 'SIGTERM');

    vi.advanceTimersByTime(10000);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Graceful shutdown timed out, forcing exit'
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('clears timeout on successful shutdown', async () => {
    await gracefulShutdown(mockServer, 'SIGTERM');
    await closeCallback?.();

    vi.advanceTimersByTime(10000);

    expect(mockExit).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledWith(0);
  });
});
