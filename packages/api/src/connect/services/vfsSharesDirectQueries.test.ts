import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getPoolMock, queryMock, requireVfsSharesClaimsMock } = vi.hoisted(
  () => ({
    getPoolMock: vi.fn(),
    queryMock: vi.fn(),
    requireVfsSharesClaimsMock: vi.fn()
  })
);

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args)
}));

vi.mock('./vfsSharesDirectHandlers.js', () => ({
  requireVfsSharesClaims: (...args: unknown[]) =>
    requireVfsSharesClaimsMock(...args)
}));

import { getItemSharesDirect } from './vfsSharesDirectQueries.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('vfsSharesDirectQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPoolMock.mockReset();
    requireVfsSharesClaimsMock.mockReset();
    getPoolMock.mockResolvedValue({
      query: queryMock
    });
    requireVfsSharesClaimsMock.mockResolvedValue({
      sub: 'user-1'
    });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('returns not found when the item does not exist', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      getItemSharesDirect(
        {
          itemId: 'missing-item'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns permission denied when caller is not the owner', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ owner_id: 'user-2' }]
    });

    await expect(
      getItemSharesDirect(
        {
          itemId: 'item-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('maps user/group/org shares and preserves valid wrapped keys', async () => {
    const createdAt = new Date('2026-03-02T00:00:00.000Z');
    queryMock
      .mockResolvedValueOnce({
        rows: [{ owner_id: 'user-1' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-1',
            item_id: 'item-1',
            share_type: 'user',
            target_id: 'user-2',
            access_level: 'read',
            created_by: 'user-1',
            created_at: createdAt,
            expires_at: null,
            target_name: 'target@example.com',
            created_by_email: 'creator@example.com',
            wrapped_session_key: 'enc-key-1',
            wrapped_hierarchical_key:
              '{"recipientPublicKeyId":"pub-1","senderSignature":"sig-1"}',
            key_epoch: 2
          },
          {
            acl_id: 'share:share-2',
            item_id: 'item-1',
            share_type: 'group',
            target_id: 'group-1',
            access_level: 'write',
            created_by: null,
            created_at: createdAt,
            expires_at: createdAt,
            target_name: null,
            created_by_email: null,
            wrapped_session_key: 'ignored-for-group',
            wrapped_hierarchical_key:
              '{"recipientPublicKeyId":"pub-2","senderSignature":"sig-2"}',
            key_epoch: 3
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'org-share:source-org:org-share-1',
            target_org_id: 'target-org',
            item_id: 'item-1',
            access_level: 'read',
            created_by: 'user-1',
            created_at: createdAt,
            expires_at: null,
            source_org_name: 'Source Org',
            target_org_name: 'Target Org',
            created_by_email: 'creator@example.com',
            wrapped_session_key: 'org-enc-key',
            wrapped_hierarchical_key:
              '{"recipientPublicKeyId":"pub-org","senderSignature":"sig-org"}',
            key_epoch: 5
          }
        ]
      });

    const response = await getItemSharesDirect(
      {
        itemId: 'item-1'
      },
      {
        requestHeader: new Headers()
      }
    );
    const shares = response.shares;
    const orgShares = response.orgShares;

    if (
      !Array.isArray(shares) ||
      !isRecord(shares[0]) ||
      !isRecord(shares[1])
    ) {
      throw new Error('Expected shares array payload');
    }
    if (!Array.isArray(orgShares) || !isRecord(orgShares[0])) {
      throw new Error('Expected orgShares array payload');
    }

    expect(shares[0]['id']).toBe('share-1');
    expect(shares[0]['wrappedKey']).toMatchObject({
      recipientUserId: 'user-2',
      recipientPublicKeyId: 'pub-1',
      keyEpoch: 2,
      encryptedKey: 'enc-key-1',
      senderSignature: 'sig-1'
    });

    expect(shares[1]['id']).toBe('share-2');
    expect(shares[1]['targetName']).toBe('Unknown');
    expect(shares[1]['createdBy']).toBe('unknown');
    expect(shares[1]['createdByEmail']).toBe('Unknown');
    expect(shares[1]['wrappedKey']).toBeUndefined();

    expect(orgShares[0]['id']).toBe('org-share-1');
    expect(orgShares[0]['wrappedKey']).toMatchObject({
      recipientOrgId: 'target-org',
      recipientPublicKeyId: 'pub-org',
      keyEpoch: 5,
      encryptedKey: 'org-enc-key',
      senderSignature: 'sig-org'
    });
  });

  it('omits wrapped keys when metadata is malformed', async () => {
    const createdAt = new Date('2026-03-02T00:00:00.000Z');
    queryMock
      .mockResolvedValueOnce({
        rows: [{ owner_id: 'user-1' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-1',
            item_id: 'item-1',
            share_type: 'user',
            target_id: 'user-2',
            access_level: 'read',
            created_by: 'user-1',
            created_at: createdAt,
            expires_at: null,
            target_name: 'target@example.com',
            created_by_email: 'creator@example.com',
            wrapped_session_key: 'enc-key-1',
            wrapped_hierarchical_key:
              '{"recipientPublicKeyId":"","senderSignature":"sig"}',
            key_epoch: 2
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'org-share:source-org:org-share-1',
            target_org_id: 'target-org',
            item_id: 'item-1',
            access_level: 'read',
            created_by: null,
            created_at: createdAt,
            expires_at: null,
            source_org_name: null,
            target_org_name: null,
            created_by_email: null,
            wrapped_session_key: 'org-enc-key',
            wrapped_hierarchical_key: 'not-json',
            key_epoch: 5
          }
        ]
      });

    const response = await getItemSharesDirect(
      {
        itemId: 'item-1'
      },
      {
        requestHeader: new Headers()
      }
    );
    const shares = response.shares;
    const orgShares = response.orgShares;

    if (!Array.isArray(shares) || !isRecord(shares[0])) {
      throw new Error('Expected shares payload');
    }
    if (!Array.isArray(orgShares) || !isRecord(orgShares[0])) {
      throw new Error('Expected orgShares payload');
    }

    expect(shares[0]['wrappedKey']).toBeUndefined();
    expect(orgShares[0]['wrappedKey']).toBeUndefined();
    expect(orgShares[0]['sourceOrgName']).toBe('Unknown');
    expect(orgShares[0]['targetOrgName']).toBe('Unknown');
    expect(orgShares[0]['createdBy']).toBe('unknown');
  });

  it('returns internal error when query execution throws unexpectedly', async () => {
    getPoolMock.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      getItemSharesDirect(
        {
          itemId: 'item-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });
});
