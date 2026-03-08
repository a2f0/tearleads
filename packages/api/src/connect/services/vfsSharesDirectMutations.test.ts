import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getPostgresPoolMock,
  loadShareAuthorizationContextMock,
  queryMock,
  requireVfsSharesClaimsMock
} = vi.hoisted(() => ({
  getPostgresPoolMock: vi.fn(),
  loadShareAuthorizationContextMock: vi.fn(),
  queryMock: vi.fn(),
  requireVfsSharesClaimsMock: vi.fn()
}));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('./vfsSharesDirectHandlers.js', async () => {
  const actual = await vi.importActual<
    typeof import('./vfsSharesDirectHandlers.js')
  >('./vfsSharesDirectHandlers.js');
  return {
    ...actual,
    requireVfsSharesClaims: (...args: unknown[]) =>
      requireVfsSharesClaimsMock(...args)
  };
});

vi.mock('./vfsSharesDirectShared.js', async () => {
  const actual = await vi.importActual<
    typeof import('./vfsSharesDirectShared.js')
  >('./vfsSharesDirectShared.js');
  return {
    ...actual,
    loadShareAuthorizationContext: (...args: unknown[]) =>
      loadShareAuthorizationContextMock(...args)
  };
});

import {
  createShareDirect,
  updateShareDirect
} from './vfsSharesDirectMutations.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('vfsSharesDirectMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPostgresPoolMock.mockReset();
    loadShareAuthorizationContextMock.mockReset();
    requireVfsSharesClaimsMock.mockReset();
    getPostgresPoolMock.mockResolvedValue({
      query: queryMock
    });
    requireVfsSharesClaimsMock.mockResolvedValue({
      sub: 'user-1'
    });
    loadShareAuthorizationContextMock.mockResolvedValue({
      ownerId: 'user-1',
      aclId: 'share:share-1'
    });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('rejects update payloads that parse to invalid/empty mutations', async () => {
    const invalidUpdatePayload = JSON.parse('{"expiresAt":123}');

    await expect(
      updateShareDirect(
        {
          shareId: 'share-1',
          ...invalidUpdatePayload
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    await expect(
      updateShareDirect(
        {
          shareId: 'share-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns not found when update authorization context is missing', async () => {
    loadShareAuthorizationContextMock.mockResolvedValueOnce(null);

    await expect(
      updateShareDirect(
        {
          shareId: 'missing-share',
          permissionLevel: 'view'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns permission denied when update caller does not own the share', async () => {
    loadShareAuthorizationContextMock.mockResolvedValueOnce({
      ownerId: 'user-2',
      aclId: 'share:share-1'
    });

    await expect(
      updateShareDirect(
        {
          shareId: 'share-1',
          permissionLevel: 'view'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('returns not found when update query does not return a row', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      updateShareDirect(
        {
          shareId: 'share-1',
          permissionLevel: 'view'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('updates group shares and falls back when lookup data is missing', async () => {
    const createdAt = new Date('2026-03-02T00:00:00.000Z');
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-1',
            item_id: 'item-1',
            share_type: 'group',
            target_id: 'group-1',
            access_level: 'write',
            created_by: null,
            created_at: createdAt,
            expires_at: null
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    const response = await updateShareDirect(
      {
        shareId: 'share-1',
        permissionLevel: 'edit'
      },
      {
        requestHeader: new Headers()
      }
    );
    if (!isRecord(response.share)) {
      throw new Error('Expected share payload');
    }

    expect(response.share['targetName']).toBe('Unknown');
    expect(response.share['createdBy']).toBe('unknown');
    expect(response.share['createdByEmail']).toBe('Unknown');
  });

  it('converts unexpected update failures to internal errors', async () => {
    getPostgresPoolMock.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      updateShareDirect(
        {
          shareId: 'share-1',
          permissionLevel: 'view'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('rejects create requests with invalid payloads', async () => {
    await expect(
      createShareDirect(
        {
          itemId: 'item-1',
          shareType: 'user'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns item/owner validation errors during create', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      createShareDirect(
        {
          itemId: 'missing-item',
          shareType: 'user',
          targetId: 'user-2',
          permissionLevel: 'view'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'item-1', owner_id: 'user-2' }]
    });

    await expect(
      createShareDirect(
        {
          itemId: 'item-1',
          shareType: 'user',
          targetId: 'user-2',
          permissionLevel: 'view'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('returns target-not-found for unknown group targets', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    await expect(
      createShareDirect(
        {
          itemId: 'item-1',
          shareType: 'group',
          targetId: 'group-1',
          permissionLevel: 'view'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('creates user shares with wrapped keys and fallback creator email', async () => {
    const createdAt = new Date('2026-03-02T00:00:00.000Z');
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ email: 'target@example.com' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-1',
            item_id: 'item-1',
            share_type: 'user',
            target_id: 'user-2',
            access_level: 'write',
            created_by: null,
            created_at: createdAt,
            expires_at: null
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    const response = await createShareDirect(
      {
        itemId: 'item-1',
        shareType: 'user',
        targetId: 'user-2',
        permissionLevel: 'edit',
        wrappedKey: {
          recipientUserId: 'user-2',
          recipientPublicKeyId: 'pub-1',
          keyEpoch: 2,
          encryptedKey: 'enc-1',
          senderSignature: 'sig-1'
        }
      },
      {
        requestHeader: new Headers()
      }
    );
    if (!isRecord(response.share)) {
      throw new Error('Expected share payload');
    }

    expect(response.share['targetName']).toBe('target@example.com');
    expect(response.share['createdBy']).toBe('user-1');
    expect(response.share['createdByEmail']).toBe('Unknown');
    expect(response.share['wrappedKey']).toMatchObject({
      recipientUserId: 'user-2',
      recipientPublicKeyId: 'pub-1',
      keyEpoch: 2,
      encryptedKey: 'enc-1',
      senderSignature: 'sig-1'
    });
  });

  it('returns already exists when insert/upsert returns no row', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ email: 'target@example.com' }]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    await expect(
      createShareDirect(
        {
          itemId: 'item-1',
          shareType: 'user',
          targetId: 'user-2',
          permissionLevel: 'view'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('maps unique-constraint errors to already exists on create', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ email: 'target@example.com' }]
      })
      .mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint')
      );

    await expect(
      createShareDirect(
        {
          itemId: 'item-1',
          shareType: 'user',
          targetId: 'user-2',
          permissionLevel: 'view'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('converts unexpected create failures to internal errors', async () => {
    getPostgresPoolMock.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      createShareDirect(
        {
          itemId: 'item-1',
          shareType: 'user',
          targetId: 'user-2',
          permissionLevel: 'view'
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
