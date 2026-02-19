import { EventEmitter } from 'node:events';
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

describe('server onData', () => {
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

  it('handles email when storage is not initialized', async () => {
    const onEmail = vi.fn();
    await createSmtpListener({ port: 2525, onEmail });

    const mockCallback = vi.fn();
    const stream = new EventEmitter();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [{ address: 'user-1@test.com' }]
      }
    };

    capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith();
    });

    expect(mockStorageStore).not.toHaveBeenCalled();
    expect(onEmail).toHaveBeenCalled();
  });

  it('processes incoming email and stores it', async () => {
    const listener = await createSmtpListener({ port: 2525 });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = new EventEmitter();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [{ address: 'user-1@test.com' }]
      }
    };

    capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('data', Buffer.from('Subject: Test\r\n\r\nBody'));
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith();
    });

    expect(mockStorageStore).toHaveBeenCalledWith(expect.any(Object), [
      'user-1'
    ]);
  });

  it('calls onEmail callback when provided', async () => {
    const onEmail = vi.fn();
    const listener = await createSmtpListener({ port: 2525, onEmail });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = new EventEmitter();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com', args: {} },
        rcptTo: [{ address: 'user-1@test.com', args: {} }]
      }
    };

    capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('data', Buffer.from('Test'));
    stream.emit('end');

    await vi.waitFor(() => {
      expect(onEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          envelope: {
            mailFrom: { address: 'sender@test.com' },
            rcptTo: [{ address: 'user-1@test.com' }]
          }
        })
      );
    });
  });

  it('filters recipients by configured domains', async () => {
    const listener = await createSmtpListener({
      port: 2525,
      recipientDomains: ['mail.test.com']
    });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = new EventEmitter();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [
          { address: 'user-1@mail.test.com' },
          { address: 'user-2@other.test.com' }
        ]
      }
    };

    capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockStorageStore).toHaveBeenCalledWith(expect.any(Object), [
        'user-1'
      ]);
    });
  });

  it('allows all domains when recipient domains are blank', async () => {
    const listener = await createSmtpListener({
      port: 2525,
      recipientDomains: ['   ']
    });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = new EventEmitter();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [{ address: 'user-1@any.test.com' }]
      }
    };

    capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockStorageStore).toHaveBeenCalledWith(expect.any(Object), [
        'user-1'
      ]);
    });
  });

  it('ignores malformed recipient addresses', async () => {
    const listener = await createSmtpListener({ port: 2525 });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = new EventEmitter();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [
          { address: 'invalid' },
          { address: 'user-1@test.com' },
          { address: 'user-2@' }
        ]
      }
    };

    capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockStorageStore).toHaveBeenCalledWith(expect.any(Object), [
        'user-1'
      ]);
    });
  });

  it('handles missing mailFrom', async () => {
    const listener = await createSmtpListener({ port: 2525 });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = new EventEmitter();
    const session = {
      envelope: {
        mailFrom: undefined,
        rcptTo: [{ address: 'user-1@test.com' }]
      }
    };

    capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockStorageStore).toHaveBeenCalledWith(
        expect.objectContaining({
          envelope: {
            mailFrom: false,
            rcptTo: [{ address: 'user-1@test.com' }]
          }
        }),
        ['user-1']
      );
    });
  });

  it('handles stream errors', async () => {
    const listener = await createSmtpListener({ port: 2525 });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = new EventEmitter();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [{ address: 'user-1@test.com' }]
      }
    };

    capturedOnDataRef.current?.(stream, session, mockCallback);
    const streamError = new Error('Stream error');
    stream.emit('error', streamError);

    expect(mockCallback).toHaveBeenCalledWith(streamError);
  });

  it('handles storage errors', async () => {
    mockStorageStore.mockRejectedValue(new Error('Storage error'));

    const listener = await createSmtpListener({ port: 2525 });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = new EventEmitter();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [{ address: 'user-1@test.com' }]
      }
    };

    capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  it('handles non-Error rejections', async () => {
    mockStorageStore.mockRejectedValue('String error');

    const listener = await createSmtpListener({ port: 2525 });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = new EventEmitter();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: []
      }
    };

    capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
