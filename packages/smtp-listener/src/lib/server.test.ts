import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type OnDataHandler = (
  stream: { on: Mock },
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
  mockServerAddress: vi.fn(() => ({ port: 2525 }))
}));

vi.mock('./storage.js', () => ({
  createStorage: vi.fn(() =>
    Promise.resolve({
      store: mockStorageStore,
      close: mockStorageClose
    })
  )
}));

vi.mock('smtp-server', () => {
  return {
    SMTPServer: class {
      server = { address: mockServerAddress };
      listen = mockServerListen;
      close = mockServerClose;
      on = mockServerOn;

      constructor(options: { onData: OnDataHandler }) {
        capturedOnDataRef.current = options.onData;
      }
    }
  };
});

import { createSmtpListener } from './server.js';

describe('server', () => {
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
    it('should create a listener with default config', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      expect(listener).toBeDefined();
      expect(listener.start).toBeInstanceOf(Function);
      expect(listener.stop).toBeInstanceOf(Function);
      expect(listener.getPort).toBeInstanceOf(Function);
    });
  });

  describe('start', () => {
    it('should start the server and connect to storage', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      await listener.start();

      expect(mockServerListen).toHaveBeenCalledWith(
        2525,
        undefined,
        expect.any(Function)
      );
    });

    it('should start with custom host', async () => {
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

    it('should handle when address returns null', async () => {
      mockServerAddress.mockReturnValue(null);

      const listener = await createSmtpListener({ port: 3000 });
      await listener.start();

      expect(listener.getPort()).toBe(3000);
    });

    it('should handle when address returns a string', async () => {
      mockServerAddress.mockReturnValue('/tmp/socket.sock');

      const listener = await createSmtpListener({ port: 4000 });
      await listener.start();

      expect(listener.getPort()).toBe(4000);
    });

    it('should reject on server error', async () => {
      mockServerListen.mockImplementation(() => {
        // Don't call the callback, trigger error instead
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
    it('should stop the server and close storage', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      await listener.start();
      await listener.stop();

      expect(mockServerClose).toHaveBeenCalled();
      expect(mockStorageClose).toHaveBeenCalled();
    });

    it('should handle storage close error gracefully', async () => {
      mockStorageClose.mockRejectedValue(new Error('Close failed'));

      const listener = await createSmtpListener({ port: 2525 });
      await listener.start();
      await listener.stop();

      expect(mockServerClose).toHaveBeenCalled();
    });

    it('should stop without storage if not started', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      await listener.stop();

      expect(mockServerClose).toHaveBeenCalled();
    });
  });

  describe('getPort', () => {
    it('should return the configured port before start', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      expect(listener.getPort()).toBe(2525);
    });

    it('should return the actual port after start', async () => {
      const listener = await createSmtpListener({ port: 0 });
      await listener.start();
      expect(listener.getPort()).toBe(2525);
    });
  });

  describe('onData handler', () => {
    it('should handle email when storage is not initialized', async () => {
      const onEmail = vi.fn();
      await createSmtpListener({ port: 2525, onEmail });

      const mockCallback = vi.fn();
      let endHandler: () => void = () => {};

      const mockStream = {
        on: vi.fn((event: string, handler: unknown) => {
          if (event === 'end') endHandler = handler as () => void;
        })
      };

      const session = {
        envelope: {
          mailFrom: { address: 'sender@test.com' },
          rcptTo: [{ address: 'recipient@test.com' }]
        }
      };

      capturedOnDataRef.current?.(mockStream, session, mockCallback);
      endHandler();

      await vi.waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith();
      });

      expect(mockStorageStore).not.toHaveBeenCalled();
      expect(onEmail).toHaveBeenCalled();
    });

    it('should process incoming email and store it', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      await listener.start();

      const mockCallback = vi.fn();
      const chunks = [Buffer.from('Subject: Test\r\n\r\nBody')];
      let dataHandler: (chunk: Buffer) => void = () => {};
      let endHandler: () => void = () => {};

      const mockStream = {
        on: vi.fn((event: string, handler: unknown) => {
          if (event === 'data') dataHandler = handler as (chunk: Buffer) => void;
          if (event === 'end') endHandler = handler as () => void;
        })
      };

      const session = {
        envelope: {
          mailFrom: { address: 'sender@test.com' },
          rcptTo: [{ address: 'recipient@test.com' }]
        }
      };

      capturedOnDataRef.current?.(mockStream, session, mockCallback);

      for (const chunk of chunks) {
        dataHandler(chunk);
      }
      endHandler();

      await vi.waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith();
      });

      expect(mockStorageStore).toHaveBeenCalled();
    });

    it('should call onEmail callback when provided', async () => {
      const onEmail = vi.fn();
      const listener = await createSmtpListener({ port: 2525, onEmail });
      await listener.start();

      const mockCallback = vi.fn();
      let dataHandler: (chunk: Buffer) => void = () => {};
      let endHandler: () => void = () => {};

      const mockStream = {
        on: vi.fn((event: string, handler: unknown) => {
          if (event === 'data') dataHandler = handler as (chunk: Buffer) => void;
          if (event === 'end') endHandler = handler as () => void;
        })
      };

      const session = {
        envelope: {
          mailFrom: { address: 'sender@test.com', name: 'Sender' },
          rcptTo: [{ address: 'recipient@test.com', name: 'Recipient' }]
        }
      };

      capturedOnDataRef.current?.(mockStream, session, mockCallback);
      dataHandler(Buffer.from('Test'));
      endHandler();

      await vi.waitFor(() => {
        expect(onEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            envelope: {
              mailFrom: { address: 'sender@test.com', name: 'Sender' },
              rcptTo: [{ address: 'recipient@test.com', name: 'Recipient' }]
            }
          })
        );
      });
    });

    it('should handle missing mailFrom', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      await listener.start();

      const mockCallback = vi.fn();
      let endHandler: () => void = () => {};

      const mockStream = {
        on: vi.fn((event: string, handler: unknown) => {
          if (event === 'end') endHandler = handler as () => void;
        })
      };

      const session = {
        envelope: {
          mailFrom: undefined,
          rcptTo: [{ address: 'recipient@test.com' }]
        }
      };

      capturedOnDataRef.current?.(mockStream, session, mockCallback);
      endHandler();

      await vi.waitFor(() => {
        expect(mockStorageStore).toHaveBeenCalledWith(
          expect.objectContaining({
            envelope: {
              mailFrom: false,
              rcptTo: [{ address: 'recipient@test.com' }]
            }
          })
        );
      });
    });

    it('should handle stream errors', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      await listener.start();

      const mockCallback = vi.fn();
      let errorHandler: (err: Error) => void = () => {};

      const mockStream = {
        on: vi.fn((event: string, handler: unknown) => {
          if (event === 'error') errorHandler = handler as (err: Error) => void;
        })
      };

      const session = {
        envelope: {
          mailFrom: { address: 'sender@test.com' },
          rcptTo: []
        }
      };

      capturedOnDataRef.current?.(mockStream, session, mockCallback);
      const streamError = new Error('Stream error');
      errorHandler(streamError);

      expect(mockCallback).toHaveBeenCalledWith(streamError);
    });

    it('should handle storage errors', async () => {
      mockStorageStore.mockRejectedValue(new Error('Storage error'));

      const listener = await createSmtpListener({ port: 2525 });
      await listener.start();

      const mockCallback = vi.fn();
      let endHandler: () => void = () => {};

      const mockStream = {
        on: vi.fn((event: string, handler: unknown) => {
          if (event === 'end') endHandler = handler as () => void;
        })
      };

      const session = {
        envelope: {
          mailFrom: { address: 'sender@test.com' },
          rcptTo: []
        }
      };

      capturedOnDataRef.current?.(mockStream, session, mockCallback);
      endHandler();

      await vi.waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith(expect.any(Error));
      });
    });

    it('should handle non-Error rejections', async () => {
      mockStorageStore.mockRejectedValue('String error');

      const listener = await createSmtpListener({ port: 2525 });
      await listener.start();

      const mockCallback = vi.fn();
      let endHandler: () => void = () => {};

      const mockStream = {
        on: vi.fn((event: string, handler: unknown) => {
          if (event === 'end') endHandler = handler as () => void;
        })
      };

      const session = {
        envelope: {
          mailFrom: { address: 'sender@test.com' },
          rcptTo: []
        }
      };

      capturedOnDataRef.current?.(mockStream, session, mockCallback);
      endHandler();

      await vi.waitFor(() => {
        expect(mockCallback).toHaveBeenCalledWith(expect.any(Error));
      });
    });
  });
});
