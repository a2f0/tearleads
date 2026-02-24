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

  it('drops email when no ingestor configured and no recipients', async () => {
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

    expect(onEmail).toHaveBeenCalled();
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

  it('drops non-uuid local-parts by default', async () => {
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
        rcptTo: [{ address: 'legacy-user@test.com' }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith();
    });
    expect(inboundIngestor.ingest).not.toHaveBeenCalled();
  });

  it('accepts non-uuid local-parts in legacy-local-part mode', async () => {
    const inboundIngestor = {
      ingest: vi.fn(async () => {})
    };
    const listener = await createSmtpListener({
      port: 2525,
      recipientAddressing: 'legacy-local-part',
      inboundIngestor
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
    expect(inboundIngestor.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['legacy-user']
      })
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
  });

  it('filters recipients by configured domains', async () => {
    const inboundIngestor = {
      ingest: vi.fn(async () => {})
    };
    const listener = await createSmtpListener({
      port: 2525,
      recipientDomains: ['mail.test.com'],
      inboundIngestor
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
      expect(inboundIngestor.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          userIds: [USER_ID_A]
        })
      );
    });
  });

  it('allows all domains when recipient domains are blank', async () => {
    const inboundIngestor = {
      ingest: vi.fn(async () => {})
    };
    const listener = await createSmtpListener({
      port: 2525,
      recipientDomains: ['   '],
      inboundIngestor
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
      expect(inboundIngestor.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          userIds: [USER_ID_A]
        })
      );
    });
  });

  it('handles missing mailFrom', async () => {
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
        mailFrom: undefined,
        rcptTo: [{ address: `${USER_ID_A}@test.com` }]
      }
    };

    smtpTestDoubles.capturedOnDataRef.current?.(stream, session, mockCallback);
    stream.emit('end');

    await vi.waitFor(() => {
      expect(inboundIngestor.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          email: expect.objectContaining({
            envelope: {
              mailFrom: false,
              rcptTo: [{ address: `${USER_ID_A}@test.com` }]
            }
          }),
          userIds: [USER_ID_A]
        })
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

  it('handles ingestor errors', async () => {
    const inboundIngestor = {
      ingest: vi.fn().mockRejectedValue(new Error('Ingest error'))
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
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  it('handles non-Error rejections', async () => {
    const inboundIngestor = {
      ingest: vi.fn().mockRejectedValue('String error')
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
    stream.emit('end');

    await vi.waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  it('ignores malformed recipient addresses', async () => {
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
      expect(inboundIngestor.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          userIds: [USER_ID_A]
        })
      );
    });
  });
});
