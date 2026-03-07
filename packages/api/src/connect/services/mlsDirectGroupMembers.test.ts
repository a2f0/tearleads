import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  broadcastMock,
  getPoolMock,
  getPostgresPoolMock,
  getActiveMlsGroupMembershipMock,
  queryMock,
  randomUuidMock,
  requireMlsClaimsMock
} = vi.hoisted(() => ({
  broadcastMock: vi.fn(),
  getPoolMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  getActiveMlsGroupMembershipMock: vi.fn(),
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

vi.mock('./mlsDirectShared.js', () => ({
  getActiveMlsGroupMembership: (...args: unknown[]) =>
    getActiveMlsGroupMembershipMock(...args)
}));

vi.mock('./mlsDirectAuth.js', () => ({
  requireMlsClaims: (...args: unknown[]) => requireMlsClaimsMock(...args)
}));

import {
  addGroupMemberDirectTyped,
  getGroupMembersDirectTyped,
  removeGroupMemberDirectTyped
} from './mlsDirectGroupMembers.js';

const ADD_MEMBER_REQUEST = {
  groupId: 'group-1',
  userId: 'member-user',
  commit: 'commit-data',
  welcome: 'welcome-data',
  keyPackageRef: 'kp-ref',
  newEpoch: 2
};

const REMOVE_MEMBER_REQUEST = {
  groupId: 'group-1',
  userId: 'member-user',
  commit: 'remove-commit',
  newEpoch: 3
};

describe('mlsDirectGroupMembers', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

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
    randomUuidMock
      .mockReturnValueOnce('welcome-1')
      .mockReturnValueOnce('commit-1');
    broadcastMock.mockResolvedValue(undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
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
      .mockResolvedValueOnce({
        rows: [
          {
            sequence_number: 8
          }
        ]
      })
      .mockResolvedValueOnce({})
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

    const response = await addGroupMemberDirectTyped(ADD_MEMBER_REQUEST, {
      requestHeader: new Headers()
    });

    const queryTexts = clientQueryMock.mock.calls
      .map((call) => call[0])
      .filter((query): query is string => typeof query === 'string');
    expect(
      queryTexts.some((query) => query.includes("source_table = 'mls_commit'"))
    ).toBe(true);
    expect(
      queryTexts.some((query) => query.includes('INSERT INTO mls_messages'))
    ).toBe(false);

    expect(response).toMatchObject({
      member: {
        userId: 'member-user',
        email: 'member@example.com',
        role: 'member',
        leafIndex: 5,
        joinedAtEpoch: 2
      }
    });
    expect(broadcastMock).toHaveBeenCalledTimes(3);
    expect(broadcastMock).toHaveBeenCalledWith(
      'mls:group:group-1',
      expect.objectContaining({
        type: 'mls:message',
        payload: expect.objectContaining({
          messageType: 'commit',
          sequenceNumber: 9,
          contentType: 'application/mls-commit'
        })
      })
    );
  });

  it('rejects addGroupMember when payload is invalid', async () => {
    await expect(
      addGroupMemberDirectTyped(
        { ...ADD_MEMBER_REQUEST, commit: '' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('rejects addGroupMember when caller is not a member', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce(null);

    await expect(
      addGroupMemberDirectTyped(ADD_MEMBER_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('rejects addGroupMember for non-admin members', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce({
      role: 'member',
      organizationId: 'org-1'
    });

    await expect(
      addGroupMemberDirectTyped(ADD_MEMBER_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('rejects addGroupMember when target user is outside org', async () => {
    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn()
    });
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      addGroupMemberDirectTyped(ADD_MEMBER_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it('rejects addGroupMember when epoch does not match', async () => {
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
      addGroupMemberDirectTyped(
        { ...ADD_MEMBER_REQUEST, newEpoch: 9 },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.AlreadyExists });
  });

  it('rejects addGroupMember when key package is unavailable', async () => {
    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ current_epoch: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rowCount: 0 })
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
      addGroupMemberDirectTyped(ADD_MEMBER_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.AlreadyExists });
  });

  it('maps addGroupMember failures to internal', async () => {
    getPostgresPoolMock.mockRejectedValueOnce(new Error('db failed'));

    await expect(
      addGroupMemberDirectTyped(ADD_MEMBER_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('returns group members', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          user_id: 'user-1',
          email: 'user-1@example.com',
          leaf_index: 0,
          role: 'admin',
          joined_at: new Date('2026-03-03T03:00:00.000Z'),
          joined_at_epoch: 0
        }
      ]
    });

    const response = await getGroupMembersDirectTyped(
      { groupId: 'group-1' },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({
      members: [
        {
          userId: 'user-1',
          email: 'user-1@example.com',
          leafIndex: 0,
          role: 'admin',
          joinedAt: '2026-03-03T03:00:00.000Z',
          joinedAtEpoch: 0
        }
      ]
    });
  });

  it('rejects getGroupMembers when caller is not a member', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce(null);

    await expect(
      getGroupMembersDirectTyped(
        { groupId: 'group-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('maps getGroupMembers failures to internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('read failed'));

    await expect(
      getGroupMembersDirectTyped(
        { groupId: 'group-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('rejects removeGroupMember for invalid payloads', async () => {
    await expect(
      removeGroupMemberDirectTyped(
        { ...REMOVE_MEMBER_REQUEST, commit: '' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('rejects removeGroupMember when caller is not a member', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce(null);

    await expect(
      removeGroupMemberDirectTyped(REMOVE_MEMBER_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('rejects removeGroupMember for non-admin members', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce({
      role: 'member',
      organizationId: 'org-1'
    });

    await expect(
      removeGroupMemberDirectTyped(REMOVE_MEMBER_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('rejects removeGroupMember when group is missing', async () => {
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
      removeGroupMemberDirectTyped(REMOVE_MEMBER_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it('rejects removeGroupMember when member is missing', async () => {
    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ current_epoch: 2 }] })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({});

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: vi.fn()
      })
    });

    await expect(
      removeGroupMemberDirectTyped(REMOVE_MEMBER_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it('removes a group member and emits removal broadcast', async () => {
    randomUuidMock.mockReturnValueOnce('commit-2');

    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ current_epoch: 2 }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            sequence_number: 11
          }
        ]
      })
      .mockResolvedValueOnce({})
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

    const response = await removeGroupMemberDirectTyped(REMOVE_MEMBER_REQUEST, {
      requestHeader: new Headers()
    });

    const queryTexts = clientQueryMock.mock.calls
      .map((call) => call[0])
      .filter((query): query is string => typeof query === 'string');
    expect(
      queryTexts.some((query) => query.includes("source_table = 'mls_commit'"))
    ).toBe(true);
    expect(
      queryTexts.some((query) => query.includes('INSERT INTO mls_messages'))
    ).toBe(false);

    expect(response).toEqual({});
    expect(broadcastMock).toHaveBeenCalledTimes(2);
    expect(broadcastMock).toHaveBeenCalledWith(
      'mls:group:group-1',
      expect.objectContaining({
        type: 'mls:message',
        payload: expect.objectContaining({
          messageType: 'commit',
          sequenceNumber: 12,
          contentType: 'application/mls-commit'
        })
      })
    );
    expect(broadcastMock).toHaveBeenCalledWith(
      'mls:group:group-1',
      expect.objectContaining({ type: 'mls:member_removed' })
    );
  });

  it('maps removeGroupMember failures to internal', async () => {
    getPostgresPoolMock.mockRejectedValueOnce(new Error('db failed'));

    await expect(
      removeGroupMemberDirectTyped(REMOVE_MEMBER_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.Internal });
  });
});
