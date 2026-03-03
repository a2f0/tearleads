import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getPoolMock, queryMock, requireScopedAdminAccessMock } = vi.hoisted(
  () => ({
    getPoolMock: vi.fn(),
    queryMock: vi.fn(),
    requireScopedAdminAccessMock: vi.fn()
  })
);

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args)
}));

vi.mock('./adminDirectAuth.js', async () => {
  const actual = await vi.importActual<typeof import('./adminDirectAuth.js')>(
    './adminDirectAuth.js'
  );
  return {
    ...actual,
    requireScopedAdminAccess: (...args: unknown[]) =>
      requireScopedAdminAccessMock(...args)
  };
});

import {
  getGroupDirect,
  getGroupMembersDirect,
  listGroupsDirect
} from './adminDirectGroups.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

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

describe('adminDirectGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPoolMock.mockReset();
    requireScopedAdminAccessMock.mockReset();

    getPoolMock.mockResolvedValue({
      query: queryMock
    });
    requireScopedAdminAccessMock.mockResolvedValue({
      sub: 'admin-1',
      adminAccess: {
        isRootAdmin: false,
        organizationIds: ['org-1']
      }
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('lists groups for root admins without organization filtering', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'group-1',
          organization_id: 'org-2',
          name: 'Engineering',
          description: null,
          created_at: new Date('2026-03-02T00:00:00.000Z'),
          updated_at: new Date('2026-03-02T00:05:00.000Z'),
          member_count: '3'
        }
      ]
    });

    const response = await listGroupsDirect(
      {
        organizationId: ''
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(requireScopedAdminAccessMock).toHaveBeenCalledWith(
      '/admin/groups',
      expect.any(Headers)
    );
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(parseJson(response.json)).toEqual({
      groups: [
        {
          id: 'group-1',
          organizationId: 'org-2',
          name: 'Engineering',
          description: null,
          createdAt: '2026-03-02T00:00:00.000Z',
          updatedAt: '2026-03-02T00:05:00.000Z',
          memberCount: 3
        }
      ]
    });
  });

  it('lists groups scoped to requested organization when accessible', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'group-2',
          organization_id: 'org-1',
          name: 'Support',
          description: 'On-call',
          created_at: new Date('2026-03-02T00:30:00.000Z'),
          updated_at: new Date('2026-03-02T00:45:00.000Z'),
          member_count: '1'
        }
      ]
    });

    const response = await listGroupsDirect(
      {
        organizationId: 'org-1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      groups: [
        {
          id: 'group-2',
          organizationId: 'org-1',
          name: 'Support',
          description: 'On-call',
          createdAt: '2026-03-02T00:30:00.000Z',
          updatedAt: '2026-03-02T00:45:00.000Z',
          memberCount: 1
        }
      ]
    });

    const call = queryMock.mock.calls.at(-1);
    if (!call) {
      throw new Error('Expected scoped groups query');
    }
    const [, params] = call;
    expect(params).toEqual([['org-1']]);
  });

  it('rejects listGroups when requested organization is not accessible', async () => {
    await expect(
      listGroupsDirect(
        {
          organizationId: 'org-999'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns not found when group does not exist', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      getGroupDirect(
        {
          id: 'missing-group'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns forbidden when group organization is inaccessible', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'group-2',
          organization_id: 'org-2',
          name: 'Ops',
          description: null,
          created_at: new Date(),
          updated_at: new Date(),
          user_id: null,
          email: null,
          joined_at: null
        }
      ]
    });

    await expect(
      getGroupDirect(
        {
          id: 'group-2'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('returns group details with members', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'group-1',
          organization_id: 'org-1',
          name: 'Engineering',
          description: 'Core team',
          created_at: new Date('2026-03-02T00:00:00.000Z'),
          updated_at: new Date('2026-03-02T00:10:00.000Z'),
          user_id: 'user-1',
          email: 'user1@example.com',
          joined_at: new Date('2026-03-02T00:20:00.000Z')
        }
      ]
    });

    const response = await getGroupDirect(
      {
        id: 'group-1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Engineering',
        description: 'Core team',
        createdAt: '2026-03-02T00:00:00.000Z',
        updatedAt: '2026-03-02T00:10:00.000Z'
      },
      members: [
        {
          userId: 'user-1',
          email: 'user1@example.com',
          joinedAt: '2026-03-02T00:20:00.000Z'
        }
      ]
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('returns internal when group organization id is invalid', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'group-1',
          organization_id: '   ',
          name: 'Engineering',
          description: null,
          created_at: new Date('2026-03-02T00:00:00.000Z'),
          updated_at: new Date('2026-03-02T00:10:00.000Z'),
          user_id: null,
          email: null,
          joined_at: null
        }
      ]
    });

    await expect(
      getGroupDirect(
        {
          id: 'group-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('returns not found when requesting members for unknown group', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      getGroupMembersDirect(
        {
          id: 'missing-group'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns forbidden for inaccessible group members', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          organization_id: 'org-2',
          user_id: null,
          email: null,
          joined_at: null
        }
      ]
    });

    await expect(
      getGroupMembersDirect(
        {
          id: 'group-2'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('returns group members when access is allowed', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          organization_id: 'org-1',
          user_id: 'user-2',
          email: 'user2@example.com',
          joined_at: new Date('2026-03-02T01:00:00.000Z')
        }
      ]
    });

    const response = await getGroupMembersDirect(
      {
        id: 'group-1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      members: [
        {
          userId: 'user-2',
          email: 'user2@example.com',
          joinedAt: '2026-03-02T01:00:00.000Z'
        }
      ]
    });
  });

  it('maps unexpected query errors to internal errors', async () => {
    getPoolMock.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      listGroupsDirect(
        {
          organizationId: ''
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
