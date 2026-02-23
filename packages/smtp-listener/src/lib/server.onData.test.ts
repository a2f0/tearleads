import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockStream,
  getSmtpTestDoubles,
  resetSmtpTestDoubles
} from '../test/serverTestDoubles.js';
import { createSmtpListener } from './server.js';

const smtpTestDoubles = getSmtpTestDoubles();
const USER_ID_A = '11111111-1111-4111-8111-111111111111';
const USER_ID_B = '22222222-2222-4222-8222-222222222222';

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
        rcptTo: [{ address: `${USER_ID_A}@test.com` }]
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
        rcptTo: [{ address: `${USER_ID_A}@test.com` }]
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
      [USER_ID_A]
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
        rcptTo: [{ address: `${USER_ID_A}@test.com`, args: {} }]
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
            rcptTo: [{ address: `${USER_ID_A}@test.com` }]
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
          { address: `${USER_ID_A}@mail.test.com` },
          { address: `${USER_ID_B}@other.test.com` }
        ]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(smtpTestDoubles.mockStorageStore).toHaveBeenCalledWith(
        expect.any(Object),
        [USER_ID_A]
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
        rcptTo: [{ address: `${USER_ID_A}@any.test.com` }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(smtpTestDoubles.mockStorageStore).toHaveBeenCalledWith(
        expect.any(Object),
        [USER_ID_A]
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
          { address: `${USER_ID_A}@test.com` },
          { address: 'user-2@' }
        ]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(smtpTestDoubles.mockStorageStore).toHaveBeenCalledWith(
        expect.any(Object),
        [USER_ID_A]
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
        rcptTo: [{ address: `${USER_ID_A}@test.com` }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(smtpTestDoubles.mockStorageStore).toHaveBeenCalledWith(
        expect.objectContaining({
          envelope: {
            mailFrom: false,
            rcptTo: [{ address: `${USER_ID_A}@test.com` }]
          }
        }),
        [USER_ID_A]
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
        rcptTo: [{ address: `${USER_ID_A}@test.com` }]
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
        rcptTo: [{ address: `${USER_ID_A}@test.com` }]
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
        rcptTo: [{ address: `${USER_ID_A}@test.com` }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  it('drops non-uuid local-parts by default', async () => {
    const listener = await createSmtpListener({ port: 2525 });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = createMockStream();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [{ address: 'legacy-user@test.com' }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith();
    });
    expect(smtpTestDoubles.mockStorageStore).not.toHaveBeenCalled();
  });

  it('accepts non-uuid local-parts in legacy-local-part mode', async () => {
    const listener = await createSmtpListener({
      port: 2525,
      recipientAddressing: 'legacy-local-part'
    });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = createMockStream();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [{ address: 'legacy-user@test.com' }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith();
    });
    expect(smtpTestDoubles.mockStorageStore).toHaveBeenCalledWith(
      expect.any(Object),
      ['legacy-user']
    );
  });

  it('uses inbound ingestor when configured', async () => {
    const inboundIngestor = {
      ingest: vi.fn(async () => {})
    };
    const listener = await createSmtpListener({
      port: 2525,
      inboundIngestor
    });
    await listener.start();

    const mockCallback = vi.fn();
    const stream = createMockStream();
    const session = {
      envelope: {
        mailFrom: { address: 'sender@test.com' },
        rcptTo: [{ address: `${USER_ID_A}@test.com` }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('data', Buffer.from('Subject: Test\r\n\r\nBody'));
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith();
    });
    expect(inboundIngestor.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        email: expect.objectContaining({
          envelope: expect.objectContaining({
            rcptTo: [{ address: `${USER_ID_A}@test.com` }]
          })
        }),
        userIds: [USER_ID_A]
      })
    );
    expect(smtpTestDoubles.mockStorageStore).not.toHaveBeenCalled();
  });
});
