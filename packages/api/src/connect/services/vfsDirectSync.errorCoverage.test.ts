import { Code, ConnectError } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPostgresPoolMock = vi.fn();
const loadVfsCrdtRematerializationSnapshotMock = vi.fn();
const queryMock = vi.fn();
const requireVfsClaimsMock = vi.fn();

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
  getCrdtSyncDirect,
  getSyncDirect
} from './vfsDirectSync.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('vfsDirectSync error coverage branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    requireVfsClaimsMock.mockReset();
    loadVfsCrdtRematerializationSnapshotMock.mockReset();

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock
    });
    requireVfsClaimsMock.mockResolvedValue({
      sub: '00000000-0000-0000-0000-000000000001'
    });
    loadVfsCrdtRematerializationSnapshotMock.mockResolvedValue({
      snapshot: {}
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('rethrows connect errors in getSyncDirect', async () => {
    queryMock.mockRejectedValueOnce(
      new ConnectError('already mapped', Code.FailedPrecondition)
    );

    await expect(
      getSyncDirect(
        {
          cursor: '',
          limit: 10,
          rootId: ''
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.FailedPrecondition
    });
  });

  it('maps non-connect snapshot errors to Internal', async () => {
    loadVfsCrdtRematerializationSnapshotMock.mockRejectedValueOnce(
      new Error('snapshot store unavailable')
    );

    await expect(
      getCrdtSnapshotDirect(
        {
          clientId: 'desktop-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('maps unexpected CRDT sync errors to Internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      getCrdtSyncDirect(
        {
          cursor: '',
          limit: 10,
          rootId: ''
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('rejects blank snapshot client ids', async () => {
    await expect(
      getCrdtSnapshotDirect(
        {
          clientId: '   '
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });
});
