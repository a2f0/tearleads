import { Code } from '@connectrpc/connect';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getPostgresPoolMock,
  loadVfsCrdtRematerializationSnapshotMock,
  queryMock,
  requireVfsClaimsMock
} = vi.hoisted(() => ({
  getPostgresPoolMock: vi.fn(),
  loadVfsCrdtRematerializationSnapshotMock: vi.fn(),
  queryMock: vi.fn(),
  requireVfsClaimsMock: vi.fn()
}));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('../../lib/vfsCrdtSnapshots.js', () => ({
  loadVfsCrdtRematerializationSnapshot: (...args: unknown[]) =>
    loadVfsCrdtRematerializationSnapshotMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import {
  getCrdtSnapshotDirect,
  getSyncDirect,
  reconcileSyncDirect
} from './vfsDirectSync.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function parseJson(json: string): unknown {
  return JSON.parse(json);
}

describe('vfsDirectSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    requireVfsClaimsMock.mockReset();
    loadVfsCrdtRematerializationSnapshotMock.mockReset();

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock
    });
    requireVfsClaimsMock.mockResolvedValue({
      sub: 'user-1'
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('rejects getSync when query params are invalid', async () => {
    await expect(
      getSyncDirect(
        {
          cursor: 'not-a-valid-cursor',
          limit: 10,
          rootId: ''
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns sync payload from mapped query rows', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    const response = await getSyncDirect(
      {
        cursor: '',
        limit: 10,
        rootId: ''
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false
    });
  });

  it('rejects getCrdtSnapshot when clientId is invalid', async () => {
    await expect(
      getCrdtSnapshotDirect(
        {
          clientId: 'bad:client'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns NotFound when no CRDT snapshot exists', async () => {
    loadVfsCrdtRematerializationSnapshotMock.mockResolvedValueOnce(null);

    await expect(
      getCrdtSnapshotDirect(
        {
          clientId: 'client-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('rejects reconcileSync when payload is invalid', async () => {
    await expect(
      reconcileSyncDirect(
        {
          json: '{}'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('stores reconcile cursor and returns encoded cursor', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          last_reconciled_at: new Date('2026-03-03T00:00:00.000Z'),
          last_reconciled_change_id: 'change-2'
        }
      ]
    });

    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'change-1'
    });

    const response = await reconcileSyncDirect(
      {
        json: JSON.stringify({
          clientId: 'client-1',
          cursor: inputCursor
        })
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      clientId: 'client-1',
      cursor: encodeVfsSyncCursor({
        changedAt: '2026-03-03T00:00:00.000Z',
        changeId: 'change-2'
      })
    });
  });
});
