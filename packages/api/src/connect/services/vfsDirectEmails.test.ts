import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clientQueryMock,
  clientReleaseMock,
  deleteVfsBlobByStorageKeyMock,
  getPoolMock,
  getPostgresPoolMock,
  readQueryMock,
  requireVfsClaimsMock,
  sendEmailMock
} = vi.hoisted(() => ({
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
  deleteVfsBlobByStorageKeyMock: vi.fn(),
  getPoolMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  readQueryMock: vi.fn(),
  requireVfsClaimsMock: vi.fn(),
  sendEmailMock: vi.fn()
}));

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

function parseJson(json: string): unknown {
  return JSON.parse(json);
}

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
            encrypted_from: 'from-1',
            encrypted_to: ['to-1', 123],
            encrypted_subject: 'subject-1',
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

    expect(parseJson(response.json)).toEqual({
      emails: [
        {
          id: 'email-1',
          from: 'from-1',
          to: ['to-1'],
          subject: 'subject-1',
          receivedAt: '2026-03-03T00:00:00.000Z',
          size: 42
        }
      ],
      total: 2,
      offset: 10,
      limit: 25
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

    expect(parseJson(response.json)).toEqual({
      success: true
    });
    expect(deleteVfsBlobByStorageKeyMock).toHaveBeenCalledWith({
      storageKey: 'storage-1'
    });
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it('rejects sendEmail when recipients are missing', async () => {
    await expect(
      sendEmailDirect(
        {
          json: '{"subject":"Hi","body":"Hello"}'
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

  it('sends email and returns message id', async () => {
    const response = await sendEmailDirect(
      {
        json: '{"to":["a@example.com"],"cc":["b@example.com"],"subject":"Hi","body":"Hello","attachments":[{"fileName":"a.txt","mimeType":"text/plain","content":"SGVsbG8="}]}'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
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
