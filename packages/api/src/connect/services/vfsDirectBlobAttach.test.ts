import { Code } from '@connectrpc/connect';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const connectMock = vi.fn();
const getPostgresPoolMock = vi.fn();
const requireVfsClaimsMock = vi.fn();

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
const CHANGE_ID_1 = '00000000-0000-0000-0000-000000000001';

describe('vfsDirectBlobAttach', () => {
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

  it('rejects attach when stagingId is missing', async () => {
    await expect(
      attachBlobDirect(
        {
          stagingId: ' ',
          itemId: 'item-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    expect(requireVfsClaimsMock).not.toHaveBeenCalled();
  });

  it('rejects attach when payload is invalid', async () => {
    await expect(
      attachBlobDirect(
        {
          stagingId: 'stage-1',
          itemId: ''
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('rejects attach when consistency guardrail payload is invalid', async () => {
    await expect(
      attachBlobDirect(
        {
          stagingId: 'stage-1',
          itemId: 'item-1',
          clientId: 'client-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns NotFound when staging row does not exist', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      attachBlobDirect(
        {
          stagingId: 'stage-missing',
          itemId: 'item-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('attaches staged blob and returns reference metadata', async () => {
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
      .mockResolvedValueOnce({
        rows: [{ id: 'ref-1', created_at: '2026-03-03T00:00:00.000Z' }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await attachBlobDirect(
      {
        stagingId: 'stage-1',
        itemId: 'item-1'
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
      refId: 'ref-1',
      attachedAt: '2026-03-03T00:00:00.000Z'
    });
    expect(clientReleaseMock).toHaveBeenCalled();
  });

  it('returns conflict when reconcile state is behind required visibility', async () => {
    const requiredCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: CHANGE_ID_1
    });

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
          itemId: 'item-1',
          clientId: 'client-1',
          requiredCursor,
          requiredLastReconciledWriteIds: {}
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('returns conflict when existing link has different relation kind', async () => {
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
            wrapped_session_key: 'blob-link:photo',
            visible_children: null
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      attachBlobDirect(
        {
          stagingId: 'stage-1',
          itemId: 'item-1',
          relationKind: 'file'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });
});
