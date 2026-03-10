import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPoolMock = vi.fn();
const getPostgresPoolMock = vi.fn();
const getActiveMlsGroupMembershipMock = vi.fn();
const parseCreateGroupPayloadMock = vi.fn();
const parseUpdateGroupPayloadMock = vi.fn();
const queryMock = vi.fn();
const randomUuidMock = vi.fn();
const requireMlsClaimsMock = vi.fn();
const toSafeCipherSuiteMock = vi.fn();

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
  parseCreateGroupPayload: (...args: unknown[]) =>
    parseCreateGroupPayloadMock(...args),
  parseUpdateGroupPayload: (...args: unknown[]) =>
    parseUpdateGroupPayloadMock(...args),
  toSafeCipherSuite: (...args: unknown[]) => toSafeCipherSuiteMock(...args)
}));

vi.mock('./mlsDirectAuth.js', () => ({
  requireMlsClaims: (...args: unknown[]) => requireMlsClaimsMock(...args)
}));

import {
  createGroupDirectTyped,
  deleteGroupDirectTyped,
  getGroupDirectTyped,
  listGroupsDirectTyped,
  updateGroupDirectTyped
} from './mlsDirectGroups.js';

describe('mlsDirectGroups', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();

    getPoolMock.mockResolvedValue({ query: queryMock });
    requireMlsClaimsMock.mockResolvedValue({ sub: 'user-1' });
    getActiveMlsGroupMembershipMock.mockResolvedValue({
      role: 'admin',
      organizationId: 'org-1'
    });
    parseCreateGroupPayloadMock.mockReturnValue({
      name: 'Group One',
      description: 'desc',
      groupIdMls: 'group-mls-1',
      cipherSuite: 1
    });
    parseUpdateGroupPayloadMock.mockReturnValue({ name: 'Next Name' });
    randomUuidMock.mockReturnValue('group-1');
    toSafeCipherSuiteMock.mockImplementation((value: unknown) => value);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('creates a group and returns the created payload', async () => {
    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const releaseMock = vi.fn();

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: releaseMock
      })
    });

    queryMock.mockResolvedValueOnce({
      rows: [{ personal_organization_id: 'org-1' }]
    });

    const response = await createGroupDirectTyped(
      {
        name: 'group',
        groupIdMls: 'group-mls-1',
        cipherSuite: 1
      },
      { requestHeader: new Headers() }
    );

    expect(response).toMatchObject({
      group: {
        id: 'group-1',
        groupIdMls: 'group-mls-1',
        creatorUserId: 'user-1',
        memberCount: 1,
        role: 'admin'
      }
    });
    expect(clientQueryMock).toHaveBeenCalledWith('BEGIN');
    expect(clientQueryMock).toHaveBeenCalledWith('COMMIT');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid create payloads', async () => {
    parseCreateGroupPayloadMock.mockReturnValueOnce(null);

    await expect(
      createGroupDirectTyped(
        {
          name: 'group',
          groupIdMls: 'group-mls-1',
          cipherSuite: 1
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('returns permission denied when caller has no scoped organization', async () => {
    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn()
    });
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      createGroupDirectTyped(
        {
          name: 'group',
          groupIdMls: 'group-mls-1',
          cipherSuite: 1
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('maps createGroup failures to internal', async () => {
    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn().mockRejectedValue(new Error('connect failed'))
    });
    queryMock.mockResolvedValueOnce({
      rows: [{ personal_organization_id: 'org-1' }]
    });

    await expect(
      createGroupDirectTyped(
        {
          name: 'group',
          groupIdMls: 'group-mls-1',
          cipherSuite: 1
        },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('lists groups from read pool', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'group-1',
          group_id_mls: 'group-mls-1',
          name: 'Group One',
          description: null,
          creator_user_id: 'user-1',
          current_epoch: 2,
          cipher_suite: 1,
          created_at: new Date('2026-03-03T03:00:00.000Z'),
          updated_at: new Date('2026-03-03T03:01:00.000Z'),
          role: 'admin',
          member_count: '4'
        }
      ]
    });

    const response = await listGroupsDirectTyped(
      {},
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({
      groups: [
        {
          id: 'group-1',
          groupIdMls: 'group-mls-1',
          name: 'Group One',
          description: null,
          creatorUserId: 'user-1',
          currentEpoch: 2,
          cipherSuite: 1,
          createdAt: '2026-03-03T03:00:00.000Z',
          updatedAt: '2026-03-03T03:01:00.000Z',
          memberCount: 4,
          role: 'admin'
        }
      ]
    });
  });

  it('maps listGroups query failures to internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('read failed'));

    await expect(
      listGroupsDirectTyped({}, { requestHeader: new Headers() })
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('returns group and members for getGroup', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'group-1',
            group_id_mls: 'group-mls-1',
            name: 'Group One',
            description: null,
            creator_user_id: 'user-1',
            current_epoch: 2,
            cipher_suite: 1,
            created_at: new Date('2026-03-03T03:00:00.000Z'),
            updated_at: new Date('2026-03-03T03:01:00.000Z')
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-1',
            email: 'user-1@example.com',
            leaf_index: 0,
            role: 'admin',
            joined_at: new Date('2026-03-03T03:02:00.000Z'),
            joined_at_epoch: 0
          }
        ]
      });

    const response = await getGroupDirectTyped(
      { groupId: 'group-1' },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({
      group: {
        id: 'group-1',
        groupIdMls: 'group-mls-1',
        name: 'Group One',
        description: null,
        creatorUserId: 'user-1',
        currentEpoch: 2,
        cipherSuite: 1,
        createdAt: '2026-03-03T03:00:00.000Z',
        updatedAt: '2026-03-03T03:01:00.000Z'
      },
      members: [
        {
          userId: 'user-1',
          email: 'user-1@example.com',
          leafIndex: 0,
          role: 'admin',
          joinedAt: '2026-03-03T03:02:00.000Z',
          joinedAtEpoch: 0
        }
      ]
    });
  });

  it('rejects getGroup when caller is not a member', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce(null);

    await expect(
      getGroupDirectTyped(
        { groupId: 'group-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('rejects getGroup with not found when group row is absent', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      getGroupDirectTyped(
        { groupId: 'group-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it('rejects getGroup when groupId is empty', async () => {
    await expect(
      getGroupDirectTyped({ groupId: '   ' }, { requestHeader: new Headers() })
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('rejects updateGroup for non-admin members', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce({
      role: 'member',
      organizationId: 'org-1'
    });
    getPostgresPoolMock.mockResolvedValue({ query: queryMock });

    await expect(
      updateGroupDirectTyped(
        { groupId: 'group-1', name: 'next' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('rejects updateGroup with invalid payload', async () => {
    parseUpdateGroupPayloadMock.mockReturnValueOnce(null);

    await expect(
      updateGroupDirectTyped(
        { groupId: 'group-1', name: 'next' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('returns not found when update touches no rows', async () => {
    getPostgresPoolMock.mockResolvedValue({ query: queryMock });
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      updateGroupDirectTyped(
        { groupId: 'group-1', name: 'next' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it('updates and returns group data', async () => {
    getPostgresPoolMock.mockResolvedValue({ query: queryMock });
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'group-1',
          group_id_mls: 'group-mls-1',
          name: 'Next Name',
          description: null,
          creator_user_id: 'user-1',
          current_epoch: 2,
          cipher_suite: 1,
          created_at: new Date('2026-03-03T03:00:00.000Z'),
          updated_at: new Date('2026-03-03T03:05:00.000Z')
        }
      ]
    });

    const response = await updateGroupDirectTyped(
      { groupId: 'group-1', name: 'next' },
      { requestHeader: new Headers() }
    );

    expect(response).toMatchObject({
      group: {
        id: 'group-1',
        name: 'Next Name',
        updatedAt: '2026-03-03T03:05:00.000Z'
      }
    });
  });

  it('marks membership as removed when deleting group membership', async () => {
    getPostgresPoolMock.mockResolvedValue({ query: queryMock });
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    const response = await deleteGroupDirectTyped(
      { groupId: 'group-1' },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({});
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE mls_group_members'),
      ['group-1', 'user-1']
    );
  });

  it('rejects deleteGroup when caller is not a member', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce(null);
    getPostgresPoolMock.mockResolvedValue({ query: queryMock });

    await expect(
      deleteGroupDirectTyped(
        { groupId: 'group-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('maps deleteGroup query failures to internal', async () => {
    getPostgresPoolMock.mockResolvedValue({ query: queryMock });
    queryMock.mockRejectedValueOnce(new Error('write failed'));

    await expect(
      deleteGroupDirectTyped(
        { groupId: 'group-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });
});
