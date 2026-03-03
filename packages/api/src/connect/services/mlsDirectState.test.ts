import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getPoolMock,
  getPostgresPoolMock,
  getActiveMlsGroupMembershipMock,
  parseUploadStatePayloadMock,
  queryMock,
  randomUuidMock,
  requireMlsClaimsMock
} = vi.hoisted(() => ({
  getPoolMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  getActiveMlsGroupMembershipMock: vi.fn(),
  parseUploadStatePayloadMock: vi.fn(),
  queryMock: vi.fn(),
  randomUuidMock: vi.fn(),
  requireMlsClaimsMock: vi.fn()
}));

vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => randomUuidMock(...args)
}));

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args),
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('./mlsDirectShared.js', () => ({
  getActiveMlsGroupMembership: (...args: unknown[]) =>
    getActiveMlsGroupMembershipMock(...args),
  parseUploadStatePayload: (...args: unknown[]) =>
    parseUploadStatePayloadMock(...args)
}));

vi.mock('./mlsDirectAuth.js', () => ({
  requireMlsClaims: (...args: unknown[]) => requireMlsClaimsMock(...args)
}));

import {
  getGroupStateDirect,
  uploadGroupStateDirect
} from './mlsDirectState.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) {
    throw new Error('Expected object JSON response');
  }

  return parsed;
}

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
    parseUploadStatePayloadMock.mockReturnValue({
      epoch: 2,
      encryptedState: 'cipher-state',
      stateHash: 'hash-1'
    });
    randomUuidMock.mockReturnValue('state-1');
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

    const response = await uploadGroupStateDirect(
      { groupId: 'group-1', json: '{"epoch":2}' },
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toEqual({
      state: {
        id: 'state-1',
        groupId: 'group-1',
        epoch: 2,
        encryptedState: 'cipher-state',
        stateHash: 'hash-1',
        createdAt: '2026-03-03T03:10:00.000Z'
      }
    });
  });

  it('rejects invalid upload payloads', async () => {
    parseUploadStatePayloadMock.mockReturnValueOnce(null);

    await expect(
      uploadGroupStateDirect(
        { groupId: 'group-1', json: '{}' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('rejects upload for non-members', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce(null);

    await expect(
      uploadGroupStateDirect(
        { groupId: 'group-1', json: '{"epoch":2}' },
        { requestHeader: new Headers() }
      )
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
      uploadGroupStateDirect(
        { groupId: 'group-1', json: '{"epoch":2}' },
        { requestHeader: new Headers() }
      )
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
      uploadGroupStateDirect(
        { groupId: 'group-1', json: '{"epoch":2}' },
        { requestHeader: new Headers() }
      )
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
      uploadGroupStateDirect(
        { groupId: 'group-1', json: '{"epoch":2}' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.AlreadyExists });
  });

  it('maps upload failures to internal', async () => {
    getPostgresPoolMock.mockRejectedValueOnce(new Error('db failed'));

    await expect(
      uploadGroupStateDirect(
        { groupId: 'group-1', json: '{"epoch":2}' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('returns null state when no snapshot exists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const response = await getGroupStateDirect(
      { groupId: 'group-1' },
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toEqual({ state: null });
  });

  it('returns latest group state when available', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'state-2',
          group_id: 'group-1',
          epoch: 2,
          encrypted_state: 'cipher-state',
          state_hash: 'hash-1',
          created_at: new Date('2026-03-03T03:12:00.000Z')
        }
      ]
    });

    const response = await getGroupStateDirect(
      { groupId: 'group-1' },
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toEqual({
      state: {
        id: 'state-2',
        groupId: 'group-1',
        epoch: 2,
        encryptedState: 'cipher-state',
        stateHash: 'hash-1',
        createdAt: '2026-03-03T03:12:00.000Z'
      }
    });
  });

  it('rejects getGroupState for non-members', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce(null);

    await expect(
      getGroupStateDirect(
        { groupId: 'group-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('maps getGroupState failures to internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('query failed'));

    await expect(
      getGroupStateDirect(
        { groupId: 'group-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });
});
