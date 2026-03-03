import { Code } from '@connectrpc/connect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getPoolMock,
  getPostgresPoolMock,
  getActiveMlsGroupMembershipMock,
  parseCreateGroupPayloadMock,
  parseUpdateGroupPayloadMock,
  queryMock,
  randomUuidMock,
  requireMlsClaimsMock,
  toSafeCipherSuiteMock
} = vi.hoisted(() => ({
  getPoolMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  getActiveMlsGroupMembershipMock: vi.fn(),
  parseCreateGroupPayloadMock: vi.fn(),
  parseUpdateGroupPayloadMock: vi.fn(),
  queryMock: vi.fn(),
  randomUuidMock: vi.fn(),
  requireMlsClaimsMock: vi.fn(),
  toSafeCipherSuiteMock: vi.fn()
}));

vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => randomUuidMock(...args)
}));

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args),
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('../../routes/mls/shared.js', () => ({
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
  createGroupDirect,
  deleteGroupDirect,
  getGroupDirect,
  listGroupsDirect,
  updateGroupDirect
} from './mlsDirectGroups.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) {
    throw new Error('Expected object JSON');
  }

  return parsed;
}

describe('mlsDirectGroups', () => {
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

    const response = await createGroupDirect(
      { json: '{"name":"group"}' },
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toMatchObject({
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

    const response = await listGroupsDirect(
      {},
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toEqual({
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

  it('rejects getGroup when caller is not a member', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce(null);

    await expect(
      getGroupDirect({ groupId: 'group-1' }, { requestHeader: new Headers() })
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('rejects updateGroup for non-admin members', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce({
      role: 'member',
      organizationId: 'org-1'
    });
    getPostgresPoolMock.mockResolvedValue({ query: queryMock });

    await expect(
      updateGroupDirect(
        { groupId: 'group-1', json: '{"name":"next"}' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('marks membership as removed when deleting group membership', async () => {
    getPostgresPoolMock.mockResolvedValue({ query: queryMock });
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    const response = await deleteGroupDirect(
      { groupId: 'group-1' },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({ json: '{}' });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE mls_group_members'),
      ['group-1', 'user-1']
    );
  });
});
