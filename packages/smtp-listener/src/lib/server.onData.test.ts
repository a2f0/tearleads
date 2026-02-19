import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockStream,
  getSmtpTestDoubles,
  resetSmtpTestDoubles
} from '../test/serverTestDoubles.js';
import { createSmtpListener } from './server.js';

const smtpTestDoubles = getSmtpTestDoubles();

describe('server onData', () => {
  beforeEach(() => {
    resetSmtpTestDoubles();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('handles email when storage is not initialized', async () => {
    const onEmail = vi.fn();
    await createSmtpListener({ port: 2525, onEmail });

    const mockCallback = vi.fn();
    const stream = createMockStream();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [{ address: 'user-1@test.com' }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith();
    });

    expect(smtpTestDoubles.mockStorageStore).not.toHaveBeenCalled();
    expect(onEmail).toHaveBeenCalled();
  });

  it('processes incoming email and stores it', async () => {
    const listener = await createSmtpListener({ port: 2525 });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = createMockStream();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [{ address: 'user-1@test.com' }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('data', Buffer.from('Subject: Test\r\n\r\nBody'));
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith();
    });

    expect(smtpTestDoubles.mockStorageStore).toHaveBeenCalledWith(
      expect.any(Object),
      ['user-1']
    );
  });

  it('calls onEmail callback when provided', async () => {
    const onEmail = vi.fn();
    const listener = await createSmtpListener({ port: 2525, onEmail });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = createMockStream();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com', args: {} },
        rcptTo: [{ address: 'user-1@test.com', args: {} }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
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
    const stream = createMockStream();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [
          { address: 'user-1@mail.test.com' },
          { address: 'user-2@other.test.com' }
        ]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(smtpTestDoubles.mockStorageStore).toHaveBeenCalledWith(
        expect.any(Object),
        ['user-1']
      );
    });
  });

  it('allows all domains when recipient domains are blank', async () => {
    const listener = await createSmtpListener({
      port: 2525,
      recipientDomains: ['   ']
    });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = createMockStream();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [{ address: 'user-1@any.test.com' }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(smtpTestDoubles.mockStorageStore).toHaveBeenCalledWith(
        expect.any(Object),
        ['user-1']
      );
    });
  });

  it('ignores malformed recipient addresses', async () => {
    const listener = await createSmtpListener({ port: 2525 });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = createMockStream();
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

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(smtpTestDoubles.mockStorageStore).toHaveBeenCalledWith(
        expect.any(Object),
        ['user-1']
      );
    });
  });

  it('handles missing mailFrom', async () => {
    const listener = await createSmtpListener({ port: 2525 });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = createMockStream();
    const session = {
      envelope: {
        mailFrom: undefined,
        rcptTo: [{ address: 'user-1@test.com' }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(smtpTestDoubles.mockStorageStore).toHaveBeenCalledWith(
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
    const stream = createMockStream();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [{ address: 'user-1@test.com' }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    const streamError = new Error('Stream error');
    stream.emit('error', streamError);

    expect(mockCallback).toHaveBeenCalledWith(streamError);
  });

  it('handles storage errors', async () => {
    smtpTestDoubles.mockStorageStore.mockRejectedValue(
      new Error('Storage error')
    );

    const listener = await createSmtpListener({ port: 2525 });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = createMockStream();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [{ address: 'user-1@test.com' }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  it('handles non-Error rejections', async () => {
    smtpTestDoubles.mockStorageStore.mockRejectedValue('String error');

    const listener = await createSmtpListener({ port: 2525 });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = createMockStream();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: []
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
