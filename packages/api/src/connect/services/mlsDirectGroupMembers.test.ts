import { Code } from '@connectrpc/connect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  broadcastMock,
  getPoolMock,
  getPostgresPoolMock,
  getActiveMlsGroupMembershipMock,
  parseAddMemberPayloadMock,
  parseRemoveMemberPayloadMock,
  queryMock,
  randomUuidMock,
  requireMlsClaimsMock
} = vi.hoisted(() => ({
  broadcastMock: vi.fn(),
  getPoolMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  getActiveMlsGroupMembershipMock: vi.fn(),
  parseAddMemberPayloadMock: vi.fn(),
  parseRemoveMemberPayloadMock: vi.fn(),
  queryMock: vi.fn(),
  randomUuidMock: vi.fn(),
  requireMlsClaimsMock: vi.fn()
}));

vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => randomUuidMock(...args)
}));

vi.mock('../../lib/broadcast.js', () => ({
  broadcast: (...args: unknown[]) => broadcastMock(...args)
}));

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args),
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('../../routes/mls/shared.js', () => ({
  getActiveMlsGroupMembership: (...args: unknown[]) =>
    getActiveMlsGroupMembershipMock(...args),
  parseAddMemberPayload: (...args: unknown[]) =>
    parseAddMemberPayloadMock(...args),
  parseRemoveMemberPayload: (...args: unknown[]) =>
    parseRemoveMemberPayloadMock(...args)
}));

vi.mock('./mlsDirectAuth.js', () => ({
  requireMlsClaims: (...args: unknown[]) => requireMlsClaimsMock(...args)
}));

import {
  addGroupMemberDirect,
  getGroupMembersDirect,
  removeGroupMemberDirect
} from './mlsDirectGroupMembers.js';

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

describe('mlsDirectGroupMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();

    getPoolMock.mockResolvedValue({ query: queryMock });
    getPostgresPoolMock.mockResolvedValue({ query: queryMock });
    requireMlsClaimsMock.mockResolvedValue({ sub: 'admin-user' });
    getActiveMlsGroupMembershipMock.mockResolvedValue({
      role: 'admin',
      organizationId: 'org-1'
    });
    parseAddMemberPayloadMock.mockReturnValue({
      userId: 'member-user',
      commit: 'commit-data',
      welcome: 'welcome-data',
      keyPackageRef: 'kp-ref',
      newEpoch: 2
    });
    parseRemoveMemberPayloadMock.mockReturnValue({
      commit: 'remove-commit',
      newEpoch: 3
    });
    randomUuidMock
      .mockReturnValueOnce('welcome-1')
      .mockReturnValueOnce('commit-1');
    broadcastMock.mockResolvedValue(undefined);
  });

  it('adds a member and emits group/user broadcasts', async () => {
    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ current_epoch: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: vi.fn()
      })
    });

    queryMock
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ email: 'member@example.com' }] });

    const response = await addGroupMemberDirect(
      { groupId: 'group-1', json: '{"userId":"member-user"}' },
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toMatchObject({
      member: {
        userId: 'member-user',
        email: 'member@example.com',
        role: 'member',
        leafIndex: 5,
        joinedAtEpoch: 2
      }
    });
    expect(broadcastMock).toHaveBeenCalledTimes(2);
  });

  it('rejects addGroupMember when epoch does not match', async () => {
    parseAddMemberPayloadMock.mockReturnValue({
      userId: 'member-user',
      commit: 'commit-data',
      welcome: 'welcome-data',
      keyPackageRef: 'kp-ref',
      newEpoch: 9
    });

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

    queryMock.mockResolvedValueOnce({ rows: [{}] });

    await expect(
      addGroupMemberDirect(
        { groupId: 'group-1', json: '{"userId":"member-user"}' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.AlreadyExists });
  });

  it('rejects getGroupMembers when caller is not a member', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce(null);

    await expect(
      getGroupMembersDirect(
        { groupId: 'group-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('removes a group member and emits removal broadcast', async () => {
    randomUuidMock.mockReturnValueOnce('commit-2');

    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ current_epoch: 2 }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: vi.fn()
      })
    });

    const response = await removeGroupMemberDirect(
      { groupId: 'group-1', userId: 'member-user', json: '{"newEpoch":3}' },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({ json: '{}' });
    expect(broadcastMock).toHaveBeenCalledTimes(1);
    expect(broadcastMock).toHaveBeenCalledWith(
      'mls:group:group-1',
      expect.objectContaining({ type: 'mls:member_removed' })
    );
  });
});
