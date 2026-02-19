import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type OnDataHandler = (
  stream: {
    on: (event: string, handler: (...args: unknown[]) => void) => void;
  },
  session: { envelope: { mailFrom: unknown; rcptTo: unknown[] } },
  callback: (err?: Error) => void
) => void;

const {
  mockStorageStore,
  mockStorageClose,
  mockServerListen,
  mockServerClose,
  mockServerOn,
  capturedOnDataRef,
  mockServerAddress
} = vi.hoisted(() => ({
  mockStorageStore: vi.fn(),
  mockStorageClose: vi.fn(),
  mockServerListen: vi.fn(),
  mockServerClose: vi.fn(),
  mockServerOn: vi.fn(),
  capturedOnDataRef: { current: null as OnDataHandler | null },
  mockServerAddress: vi.fn<() => { port: number } | string | null>(() => ({
    port: 2525
  }))
}));

vi.mock('./storage.js', () => ({
  createStorage: vi.fn(() =>
    Promise.resolve({
      store: mockStorageStore,
      close: mockStorageClose
    })
  )
}));

vi.mock('smtp-server', () => ({
  SMTPServer: class {
    server = { address: mockServerAddress };
    listen = mockServerListen;
    close = mockServerClose;
    on = mockServerOn;

    constructor(options: { onData: OnDataHandler }) {
      capturedOnDataRef.current = options.onData;
    }
  }
}));

import { createSmtpListener } from './server.js';

describe('server lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServerAddress.mockReturnValue({ port: 2525 });
    mockServerListen.mockImplementation(
      (_port: number, _host: string | undefined, callback: () => void) => {
        callback();
      }
    );
    mockServerClose.mockImplementation((callback: () => void) => {
      callback();
    });
    mockStorageStore.mockResolvedValue(undefined);
    mockStorageClose.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createSmtpListener', () => {
    it('creates a listener with default config', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      expect(listener).toBeDefined();
      expect(listener.start).toBeInstanceOf(Function);
      expect(listener.stop).toBeInstanceOf(Function);
      expect(listener.getPort).toBeInstanceOf(Function);
    });
  });

  describe('start', () => {
    it('starts the server and connects to storage', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      await listener.start();

      expect(mockServerListen).toHaveBeenCalledWith(
        2525,
        undefined,
        expect.any(Function)
      );
    });

    it('starts with custom host', async () => {
      const listener = await createSmtpListener({
        port: 2525,
        host: '127.0.0.1'
      });
      await listener.start();

      expect(mockServerListen).toHaveBeenCalledWith(
        2525,
        '127.0.0.1',
        expect.any(Function)
      );
    });

    it('handles when address returns null', async () => {
      mockServerAddress.mockReturnValue(null);

      const listener = await createSmtpListener({ port: 3000 });
      await listener.start();

      expect(listener.getPort()).toBe(3000);
    });

    it('handles when address returns a string', async () => {
      mockServerAddress.mockReturnValue('/tmp/socket.sock');

      const listener = await createSmtpListener({ port: 4000 });
      await listener.start();

      expect(listener.getPort()).toBe(4000);
    });

    it('rejects on server error', async () => {
      mockServerListen.mockImplementation(() => {
        // Intentionally unresolved to assert server error path.
      });
      mockServerOn.mockImplementation(
        (event: string, handler: (err: Error) => void) => {
          if (event === 'error') {
            setTimeout(() => handler(new Error('Port in use')), 0);
          }
        }
      );

      const listener = await createSmtpListener({ port: 2525 });
      await expect(listener.start()).rejects.toThrow('Port in use');
    });
  });

  describe('stop', () => {
    it('stops the server and closes storage', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      await listener.start();
      await listener.stop();

      expect(mockServerClose).toHaveBeenCalled();
      expect(mockStorageClose).toHaveBeenCalled();
    });

    it('handles storage close error gracefully', async () => {
      mockStorageClose.mockRejectedValue(new Error('Close failed'));
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const listener = await createSmtpListener({ port: 2525 });
      await listener.start();
      await listener.stop();

      expect(mockServerClose).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to close Redis storage on SMTP listener stop:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('stops without storage if not started', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      await listener.stop();

      expect(mockServerClose).toHaveBeenCalled();
    });
  });

  describe('getPort', () => {
    it('returns the configured port before start', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      expect(listener.getPort()).toBe(2525);
    });

    it('returns the actual port after start', async () => {
      const listener = await createSmtpListener({ port: 0 });
      await listener.start();
      expect(listener.getPort()).toBe(2525);
    });
  });
});
