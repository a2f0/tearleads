import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getPostgresPoolMock, queryMock, requireVfsSharesClaimsMock } =
  vi.hoisted(() => ({
    getPostgresPoolMock: vi.fn(),
    queryMock: vi.fn(),
    requireVfsSharesClaimsMock: vi.fn()
  }));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('./vfsSharesDirectHandlers.js', () => ({
  requireVfsSharesClaims: (...args: unknown[]) =>
    requireVfsSharesClaimsMock(...args)
}));

import { createOrgShareDirect } from './vfsSharesDirectOrgMutations.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('vfsSharesDirectOrgMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPostgresPoolMock.mockReset();
    requireVfsSharesClaimsMock.mockReset();
    getPostgresPoolMock.mockResolvedValue({
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

  it('rejects invalid payloads', async () => {
    await expect(
      createOrgShareDirect(
        {
          itemId: 'item-1',
          sourceOrgId: 'org-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns item validation errors', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      createOrgShareDirect(
        {
          itemId: 'missing-item',
          sourceOrgId: 'org-1',
          targetOrgId: 'org-2',
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
      createOrgShareDirect(
        {
          itemId: 'item-1',
          sourceOrgId: 'org-1',
          targetOrgId: 'org-2',
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

  it('returns source/target organization not found errors', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    await expect(
      createOrgShareDirect(
        {
          itemId: 'item-1',
          sourceOrgId: 'org-1',
          targetOrgId: 'org-2',
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
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ name: 'Source Org' }]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    await expect(
      createOrgShareDirect(
        {
          itemId: 'item-1',
          sourceOrgId: 'org-1',
          targetOrgId: 'org-2',
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

  it('creates org shares and includes wrapped keys', async () => {
    const createdAt = new Date('2026-03-02T00:00:00.000Z');
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ name: 'Source Org' }]
      })
      .mockResolvedValueOnce({
        rows: [{ name: 'Target Org' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'org-share:org-1:org-share-1',
            item_id: 'item-1',
            target_org_id: 'org-2',
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

    const response = await createOrgShareDirect(
      {
        itemId: 'item-1',
        sourceOrgId: 'org-1',
        targetOrgId: 'org-2',
        permissionLevel: 'edit',
        wrappedKey: {
          recipientOrgId: 'org-2',
          recipientPublicKeyId: 'pub-1',
          keyEpoch: 3,
          encryptedKey: 'enc-key',
          senderSignature: 'sig-1'
        }
      },
      {
        requestHeader: new Headers()
      }
    );
    if (!isRecord(response.orgShare)) {
      throw new Error('Expected orgShare payload');
    }

    expect(response.orgShare['id']).toBe('org-share-1');
    expect(response.orgShare['sourceOrgName']).toBe('Source Org');
    expect(response.orgShare['targetOrgName']).toBe('Target Org');
    expect(response.orgShare['createdBy']).toBe('user-1');
    expect(response.orgShare['createdByEmail']).toBe('Unknown');
    expect(response.orgShare['wrappedKey']).toMatchObject({
      recipientOrgId: 'org-2',
      recipientPublicKeyId: 'pub-1',
      keyEpoch: 3,
      encryptedKey: 'enc-key',
      senderSignature: 'sig-1'
    });
  });

  it('returns already exists when insert/upsert produces no row', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ name: 'Source Org' }]
      })
      .mockResolvedValueOnce({
        rows: [{ name: 'Target Org' }]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    await expect(
      createOrgShareDirect(
        {
          itemId: 'item-1',
          sourceOrgId: 'org-1',
          targetOrgId: 'org-2',
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

  it('maps duplicate key failures to already exists', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'item-1', owner_id: 'user-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ name: 'Source Org' }]
      })
      .mockResolvedValueOnce({
        rows: [{ name: 'Target Org' }]
      })
      .mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint')
      );

    await expect(
      createOrgShareDirect(
        {
          itemId: 'item-1',
          sourceOrgId: 'org-1',
          targetOrgId: 'org-2',
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

  it('converts unexpected failures to internal errors', async () => {
    getPostgresPoolMock.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      createOrgShareDirect(
        {
          itemId: 'item-1',
          sourceOrgId: 'org-1',
          targetOrgId: 'org-2',
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
