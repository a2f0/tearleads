import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const deleteVfsBlobByStorageKeyMock = vi.fn();
const getPoolMock = vi.fn();
const getPostgresPoolMock = vi.fn();
const readQueryMock = vi.fn();
const requireVfsClaimsMock = vi.fn();
const sendEmailMock = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args),
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('../../lib/vfsBlobStore.js', () => ({
  deleteVfsBlobByStorageKey: (...args: unknown[]) =>
    deleteVfsBlobByStorageKeyMock(...args)
}));

vi.mock('../../lib/emailSender.js', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import {
  deleteEmailDirect,
  getEmailDirect,
  getEmailsDirect,
  sendEmailDirect
} from './vfsDirectEmails.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('vfsDirectEmails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientQueryMock.mockReset();
    clientReleaseMock.mockReset();
    deleteVfsBlobByStorageKeyMock.mockReset();
    readQueryMock.mockReset();
    requireVfsClaimsMock.mockReset();
    sendEmailMock.mockReset();

    getPoolMock.mockResolvedValue({
      query: readQueryMock
    });
    getPostgresPoolMock.mockResolvedValue({
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: clientReleaseMock
      })
    });

    requireVfsClaimsMock.mockResolvedValue({
      sub: 'user-1'
    });
    sendEmailMock.mockResolvedValue({
      success: true,
      messageId: 'msg-1'
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('returns paginated email list for the user', async () => {
    readQueryMock
      .mockResolvedValueOnce({
        rows: [{ total: '2' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'email-1',
            encrypted_from: 'c3lzdGVtQHRlYXJsZWFkcy5jb20=',
            encrypted_to: ['Ym9iQHRlc3QubG9jYWw=', 123],
            encrypted_subject: 'V2VsY29tZSB0byBUZWFybGVhZHM=',
            received_at: '2026-03-03T00:00:00.000Z',
            ciphertext_size: 42
          }
        ]
      });

    const response = await getEmailsDirect(
      {
        offset: 10,
        limit: 25
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(response).toEqual({
      emails: [
        {
          id: 'email-1',
          from: 'system@tearleads.com',
          to: ['bob@test.local'],
          subject: 'Welcome to Tearleads',
          receivedAt: '2026-03-03T00:00:00.000Z',
          size: 42
        }
      ],
      total: 2,
      offset: 10,
      limit: 25
    });
  });

  it('normalizes getEmails pagination and recipient arrays', async () => {
    readQueryMock
      .mockResolvedValueOnce({
        rows: [{ total: '1' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'email-2',
            encrypted_from: null,
            encrypted_to: 'not-an-array',
            encrypted_subject: null,
            received_at: '2026-03-03T00:00:00.000Z',
            ciphertext_size: null
          }
        ]
      });

    const response = await getEmailsDirect(
      {
        offset: -20,
        limit: 0
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(response).toEqual({
      emails: [
        {
          id: 'email-2',
          from: '',
          to: [],
          subject: '',
          receivedAt: '2026-03-03T00:00:00.000Z',
          size: 0
        }
      ],
      total: 1,
      offset: 0,
      limit: 50
    });
  });

  it('rejects getEmail when id is blank', async () => {
    await expect(
      getEmailDirect(
        {
          id: '  '
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns not found when getEmail cannot find the record', async () => {
    readQueryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      getEmailDirect(
        {
          id: 'missing-email'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns email payload with fallback nullable fields', async () => {
    readQueryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'email-7',
          encrypted_from: null,
          encrypted_to: [1, 2],
          encrypted_subject: null,
          received_at: '2026-03-03T00:00:00.000Z',
          ciphertext_size: null,
          encrypted_body_path: null
        }
      ]
    });

    const response = await getEmailDirect(
      {
        id: 'email-7'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(response).toEqual({
      id: 'email-7',
      from: '',
      to: [],
      subject: '',
      receivedAt: '2026-03-03T00:00:00.000Z',
      size: 0,
      rawData: ''
    });
  });

  it('rejects deleteEmail when id is blank', async () => {
    await expect(
      deleteEmailDirect(
        {
          id: ' '
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns NotFound when delete lookup misses email row', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      deleteEmailDirect(
        {
          id: 'missing-email'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns NotFound when delete does not remove the row', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ storage_key: null }]
      })
      .mockResolvedValueOnce({
        rows: []
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      deleteEmailDirect(
        {
          id: 'email-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('deletes email metadata and orphaned storage key', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ storage_key: 'storage-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'email-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ count: '0' }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await deleteEmailDirect(
      {
        id: 'email-1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(response).toEqual({ success: true });
    expect(deleteVfsBlobByStorageKeyMock).toHaveBeenCalledWith({
      storageKey: 'storage-1'
    });
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it('does not delete blob when storage key is still referenced', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ storage_key: 'storage-2' }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'email-9' }]
      })
      .mockResolvedValueOnce({
        rows: [{ count: '2' }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await deleteEmailDirect(
      {
        id: 'email-9'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(response).toEqual({ success: true });
    expect(deleteVfsBlobByStorageKeyMock).not.toHaveBeenCalled();
  });

  it('keeps delete successful when blob cleanup fails', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ storage_key: 'storage-3' }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'email-3' }]
      })
      .mockResolvedValueOnce({
        rows: [{ count: '0' }]
      })
      .mockResolvedValueOnce({ rows: [] });
    deleteVfsBlobByStorageKeyMock.mockRejectedValueOnce(
      new Error('blob cleanup failed')
    );

    const response = await deleteEmailDirect(
      {
        id: 'email-3'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(response).toEqual({ success: true });
  });

  it('rejects sendEmail when recipients are missing', async () => {
    await expect(
      sendEmailDirect(
        {
          subject: 'Hi',
          body: 'Hello'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('rejects sendEmail when attachments are malformed', async () => {
    await expect(
      sendEmailDirect(
        {
          to: ['a@example.com'],
          subject: 'Hi',
          attachments: [{ fileName: 'a.txt' }]
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('maps sender failures to Internal', async () => {
    sendEmailMock.mockResolvedValueOnce({
      success: false,
      error: 'smtp unavailable'
    });
    await expect(
      sendEmailDirect(
        {
          to: ['a@example.com'],
          subject: 'Hi',
          body: 'Hello'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('maps unexpected sender exceptions to Internal', async () => {
    sendEmailMock.mockRejectedValueOnce(new Error('boom'));
    await expect(
      sendEmailDirect(
        {
          to: ['a@example.com'],
          subject: 'Hi',
          body: 'Hello'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('sends email and returns message id', async () => {
    const response = await sendEmailDirect(
      {
        to: ['a@example.com'],
        cc: ['b@example.com'],
        subject: 'Hi',
        body: 'Hello',
        attachments: [
          {
            fileName: 'a.txt',
            mimeType: 'text/plain',
            content: 'SGVsbG8='
          }
        ]
      },
      {
        requestHeader: new Headers()
      }
    );
    expect(response).toEqual({
      success: true,
      messageId: 'msg-1'
    });
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: ['a@example.com'],
      cc: ['b@example.com'],
      subject: 'Hi',
      text: 'Hello',
      attachments: [
        {
          filename: 'a.txt',
          content: Buffer.from('SGVsbG8=', 'base64'),
          contentType: 'text/plain'
        }
      ]
    });
  });
});
