import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clientQueryMock,
  clientReleaseMock,
  connectMock,
  getPostgresPoolMock,
  requireVfsClaimsMock
} = vi.hoisted(() => ({
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
  connectMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  requireVfsClaimsMock: vi.fn()
}));

vi.mock('node:crypto', () => ({
  randomUUID: () => 'uuid-1'
}));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import { attachBlobDirect } from './vfsDirectBlobAttach.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('vfsDirectBlobAttach coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientQueryMock.mockReset();
    clientReleaseMock.mockReset();
    connectMock.mockReset();
    getPostgresPoolMock.mockReset();
    requireVfsClaimsMock.mockReset();

    connectMock.mockResolvedValue({
      query: clientQueryMock,
      release: clientReleaseMock
    });
    getPostgresPoolMock.mockResolvedValue({
      connect: connectMock
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

  it('returns Internal when staged metadata is malformed', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: '',
            staged_by: 'user-1',
            organization_id: 'org-1',
            status: 'staged',
            expires_at: '2099-01-01T00:00:00.000Z'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      attachBlobDirect(
        {
          stagingId: 'stage-1',
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

  it('returns Forbidden when caller does not own staging row', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            staged_by: 'user-2',
            organization_id: 'org-1',
            status: 'staged',
            expires_at: '2099-01-01T00:00:00.000Z'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      attachBlobDirect(
        {
          stagingId: 'stage-1',
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

  it('returns conflict when staging has expired', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            staged_by: 'user-1',
            organization_id: 'org-1',
            status: 'staged',
            expires_at: '2000-01-01T00:00:00.000Z'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      attachBlobDirect(
        {
          stagingId: 'stage-1',
          itemId: 'item-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('returns conflict when stage transition update does not return a row', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            staged_by: 'user-1',
            organization_id: 'org-1',
            status: 'staged',
            expires_at: '2099-01-01T00:00:00.000Z'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      attachBlobDirect(
        {
          stagingId: 'stage-1',
          itemId: 'item-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('returns conflict when blob registry id is not a file', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            staged_by: 'user-1',
            organization_id: 'org-1',
            status: 'staged',
            expires_at: '2099-01-01T00:00:00.000Z'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            attached_at: '2026-03-03T00:00:00.000Z',
            attached_item_id: 'item-1'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ object_type: 'folder' }]
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      attachBlobDirect(
        {
          stagingId: 'stage-1',
          itemId: 'item-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('returns existing reference when relation kind matches', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            staged_by: 'user-1',
            organization_id: 'org-1',
            status: 'staged',
            expires_at: '2099-01-01T00:00:00.000Z'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            blob_id: 'blob-1',
            attached_at: '2026-03-03T00:00:00.000Z',
            attached_item_id: 'item-1'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ object_type: 'file', organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'ref-existing',
            created_at: '2026-03-03T00:00:00.000Z',
            wrapped_session_key: 'blob-link:file',
            visible_children: null
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await attachBlobDirect(
      {
        stagingId: 'stage-1',
        itemId: 'item-1',
        relationKind: 'file'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(response).toEqual({
      attached: true,
      stagingId: 'stage-1',
      blobId: 'blob-1',
      itemId: 'item-1',
      relationKind: 'file',
      refId: 'ref-existing',
      attachedAt: '2026-03-03T00:00:00.000Z'
    });
  });

  it('maps unexpected attach exceptions to Internal', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('db panic'))
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      attachBlobDirect(
        {
          stagingId: 'stage-1',
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
