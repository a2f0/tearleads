import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPoolMock = vi.fn();
const getPostgresPoolMock = vi.fn();
const getActiveMlsGroupMembershipMock = vi.fn();
const queryMock = vi.fn();
const requireMlsClaimsMock = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args),
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('./mlsDirectShared.js', () => ({
  getActiveMlsGroupMembership: (...args: unknown[]) =>
    getActiveMlsGroupMembershipMock(...args)
}));

vi.mock('./mlsDirectAuth.js', () => ({
  requireMlsClaims: (...args: unknown[]) => requireMlsClaimsMock(...args)
}));

import {
  getGroupStateDirectTyped,
  uploadGroupStateDirectTyped
} from './mlsDirectState.js';

const textEncoder = new TextEncoder();
const STATE_BYTES_BASE64 = 'c3RhdGUtYnl0ZXM=';
const STATE_BYTES_HASH = 'wAEDKaM8s6FdpeNW0sAr8nS7ZQCBwhZ0F3ClXnVBabQ=';
const UPLOAD_STATE_REQUEST = {
  groupId: 'group-1',
  epoch: 2,
  encryptedState: textEncoder.encode('state-bytes'),
  stateHash: STATE_BYTES_HASH
};

describe('mlsDirectState', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();

    getPoolMock.mockResolvedValue({ query: queryMock });
    getPostgresPoolMock.mockResolvedValue({ query: queryMock });
    requireMlsClaimsMock.mockResolvedValue({ sub: 'user-1' });
    getActiveMlsGroupMembershipMock.mockResolvedValue({
      role: 'member',
      organizationId: 'org-1'
    });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('uploads group state snapshots', async () => {
    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ current_epoch: 2 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'state-1',
            created_at: new Date('2026-03-03T03:10:00.000Z')
          }
        ]
      })
      .mockResolvedValueOnce({});

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: vi.fn()
      })
    });

    const response = await uploadGroupStateDirectTyped(UPLOAD_STATE_REQUEST, {
      requestHeader: new Headers()
    });

    expect(response).toEqual({
      state: {
        id: 'state-1',
        groupId: 'group-1',
        epoch: 2,
        encryptedState: textEncoder.encode('state-bytes'),
        stateHash: STATE_BYTES_HASH,
        createdAt: '2026-03-03T03:10:00.000Z'
      }
    });
  });

  it('rejects invalid upload payloads', async () => {
    await expect(
      uploadGroupStateDirectTyped(
        { ...UPLOAD_STATE_REQUEST, encryptedState: new Uint8Array() },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('rejects upload for non-members', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce(null);

    await expect(
      uploadGroupStateDirectTyped(UPLOAD_STATE_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('rejects upload when group is missing', async () => {
    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: vi.fn()
      })
    });

    await expect(
      uploadGroupStateDirectTyped(UPLOAD_STATE_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it('rejects upload when payload epoch is ahead of group epoch', async () => {
    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ current_epoch: 1 }] })
      .mockResolvedValueOnce({});

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: vi.fn()
      })
    });

    await expect(
      uploadGroupStateDirectTyped(UPLOAD_STATE_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.AlreadyExists });
  });

  it('rejects upload when newer state already exists', async () => {
    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ current_epoch: 2 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: vi.fn()
      })
    });

    await expect(
      uploadGroupStateDirectTyped(UPLOAD_STATE_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.AlreadyExists });
  });

  it('maps upload failures to internal', async () => {
    getPostgresPoolMock.mockRejectedValueOnce(new Error('db failed'));

    await expect(
      uploadGroupStateDirectTyped(UPLOAD_STATE_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('rejects upload when stateHash does not match encryptedState bytes', async () => {
    await expect(
      uploadGroupStateDirectTyped(
        {
          ...UPLOAD_STATE_REQUEST,
          stateHash: 'invalid-hash'
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('returns null state when no snapshot exists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const response = await getGroupStateDirectTyped(
      { groupId: 'group-1' },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({ state: null });
  });

  it('returns latest group state when available', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'state-2',
          group_id: 'group-1',
          epoch: 2,
          encrypted_state: STATE_BYTES_BASE64,
          state_hash: STATE_BYTES_HASH,
          created_at: new Date('2026-03-03T03:12:00.000Z')
        }
      ]
    });

    const response = await getGroupStateDirectTyped(
      { groupId: 'group-1' },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({
      state: {
        id: 'state-2',
        groupId: 'group-1',
        epoch: 2,
        encryptedState: textEncoder.encode('state-bytes'),
        stateHash: STATE_BYTES_HASH,
        createdAt: '2026-03-03T03:12:00.000Z'
      }
    });
  });

  it('rejects getGroupState when stored state hash is invalid', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'state-2',
          group_id: 'group-1',
          epoch: 2,
          encrypted_state: STATE_BYTES_BASE64,
          state_hash: 'invalid-hash',
          created_at: new Date('2026-03-03T03:12:00.000Z')
        }
      ]
    });

    await expect(
      getGroupStateDirectTyped(
        { groupId: 'group-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('rejects getGroupState for non-members', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce(null);

    await expect(
      getGroupStateDirectTyped(
        { groupId: 'group-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('maps getGroupState failures to internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('query failed'));

    await expect(
      getGroupStateDirectTyped(
        { groupId: 'group-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });
});
