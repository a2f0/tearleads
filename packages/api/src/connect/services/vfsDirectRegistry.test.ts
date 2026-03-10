import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const getPostgresPoolMock = vi.fn();
const queryMock = vi.fn();
const requireVfsClaimsMock = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import { registerDirect, rekeyItemDirect } from './vfsDirectRegistry.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('vfsDirectRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientQueryMock.mockReset();
    clientReleaseMock.mockReset();
    queryMock.mockReset();
    requireVfsClaimsMock.mockReset();

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: clientReleaseMock
      })
    });

    requireVfsClaimsMock.mockResolvedValue({
      sub: 'user-1',
      organizationId: 'org-1'
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('rejects register when payload is invalid', async () => {
    await expect(
      registerDirect(
        {},
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('maps duplicate register id to AlreadyExists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ one: 1 }] });

    await expect(
      registerDirect(
        {
          id: 'item-1',
          objectType: 'file',
          encryptedSessionKey: 'enc'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('returns registration metadata when insert succeeds', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          created_at: new Date('2026-03-03T00:00:00.000Z')
        }
      ]
    });

    const response = await registerDirect(
      {
        id: 'item-1',
        objectType: 'file',
        encryptedSessionKey: 'enc'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(response).toEqual({
      id: 'item-1',
      createdAt: '2026-03-03T00:00:00.000Z'
    });
  });

  it('rejects rekey when itemId is empty', async () => {
    await expect(
      rekeyItemDirect(
        {
          itemId: '   '
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('rejects rekey when payload is malformed', async () => {
    await expect(
      rekeyItemDirect(
        {
          itemId: 'item-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('returns not found when rekey item does not exist', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      rekeyItemDirect(
        {
          itemId: 'item-missing',
          reason: 'manual',
          newEpoch: 2,
          wrappedKeys: []
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });

    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it('applies wrapped keys and returns wrapsApplied count', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'item-1',
            owner_id: 'user-1'
          }
        ]
      })
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({ rows: [] });

    const response = await rekeyItemDirect(
      {
        itemId: 'item-1',
        reason: 'manual',
        newEpoch: 2,
        wrappedKeys: [
          {
            recipientUserId: 'user-2',
            recipientPublicKeyId: 'pub-1',
            keyEpoch: 2,
            encryptedKey: 'enc',
            senderSignature: 'sig'
          },
          {
            recipientUserId: 'user-3',
            recipientPublicKeyId: 'pub-2',
            keyEpoch: 2,
            encryptedKey: 'enc2',
            senderSignature: 'sig2'
          }
        ]
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(response).toEqual({
      itemId: 'item-1',
      newEpoch: 2,
      wrapsApplied: 2
    });
    expect(clientReleaseMock).toHaveBeenCalled();
  });
});
