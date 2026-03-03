import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  deleteAllSessionsForUserMock,
  getLatestLastActiveByUserIdsMock,
  getPoolMock,
  queryMock,
  requireScopedAdminAccessMock
} = vi.hoisted(() => ({
  deleteAllSessionsForUserMock: vi.fn(),
  getLatestLastActiveByUserIdsMock: vi.fn(),
  getPoolMock: vi.fn(),
  queryMock: vi.fn(),
  requireScopedAdminAccessMock: vi.fn()
}));

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args)
}));

vi.mock('../../lib/sessions.js', () => ({
  deleteAllSessionsForUser: (...args: unknown[]) =>
    deleteAllSessionsForUserMock(...args),
  getLatestLastActiveByUserIds: (...args: unknown[]) =>
    getLatestLastActiveByUserIdsMock(...args)
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
  getUserDirect,
  listUsersDirect,
  updateUserDirect
} from './adminDirectUsers.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object');
  }
  return parsed;
}

describe('adminDirectUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPoolMock.mockReset();
    requireScopedAdminAccessMock.mockReset();
    getLatestLastActiveByUserIdsMock.mockReset();
    deleteAllSessionsForUserMock.mockReset();

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
    getLatestLastActiveByUserIdsMock.mockResolvedValue({});
    deleteAllSessionsForUserMock.mockResolvedValue(undefined);

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('lists users scoped to accessible organizations', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'user-1',
            email: 'user1@example.com',
            email_confirmed: true,
            admin: false,
            disabled: false,
            disabled_at: null,
            disabled_by: null,
            marked_for_deletion_at: null,
            marked_for_deletion_by: null,
            created_at: new Date('2026-03-03T00:00:00.000Z'),
            organization_ids: ['org-1']
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-1',
            total_prompt_tokens: '10',
            total_completion_tokens: '4',
            total_tokens: '14',
            request_count: '2',
            last_used_at: new Date('2026-03-03T00:10:00.000Z')
          }
        ]
      });
    getLatestLastActiveByUserIdsMock.mockResolvedValueOnce({
      'user-1': '2026-03-03T00:20:00.000Z'
    });

    const response = await listUsersDirect(
      {
        organizationId: 'org-1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      users: [
        {
          id: 'user-1',
          email: 'user1@example.com',
          emailConfirmed: true,
          admin: false,
          organizationIds: ['org-1'],
          createdAt: '2026-03-03T00:00:00.000Z',
          lastActiveAt: '2026-03-03T00:20:00.000Z',
          accounting: {
            totalPromptTokens: 10,
            totalCompletionTokens: 4,
            totalTokens: 14,
            requestCount: 2,
            lastUsedAt: '2026-03-03T00:10:00.000Z'
          },
          disabled: false,
          disabledAt: null,
          disabledBy: null,
          markedForDeletionAt: null,
          markedForDeletionBy: null
        }
      ]
    });

    expect(requireScopedAdminAccessMock).toHaveBeenCalledWith(
      '/admin/users',
      expect.any(Headers)
    );
    const call = queryMock.mock.calls[0];
    expect(call?.[1]).toEqual([['org-1']]);
  });

  it('rejects listUsers for inaccessible organization filter', async () => {
    await expect(
      listUsersDirect(
        {
          organizationId: 'org-2'
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

  it('returns not found when user is missing', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      getUserDirect(
        {
          id: 'missing-user'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('requires root admin for updateUser', async () => {
    await expect(
      updateUserDirect(
        {
          id: 'user-1',
          json: '{"disabled":true}'
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

  it('rejects invalid updateUser payloads', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });

    await expect(
      updateUserDirect(
        {
          id: 'user-1',
          json: '{"emailConfirmed":"yes"}'
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

  it('updates and disables a user, then clears sessions', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });
    queryMock
      .mockResolvedValueOnce({ rowCount: null })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'user-1',
            email: 'user1@example.com',
            email_confirmed: true,
            admin: false,
            disabled: true,
            disabled_at: new Date('2026-03-03T00:30:00.000Z'),
            disabled_by: 'admin-root',
            marked_for_deletion_at: null,
            marked_for_deletion_by: null
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ created_at: new Date('2026-03-03T00:00:00.000Z') }]
      })
      .mockResolvedValueOnce({ rowCount: null })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 'user-1',
            total_prompt_tokens: '8',
            total_completion_tokens: '2',
            total_tokens: '10',
            request_count: '1',
            last_used_at: new Date('2026-03-03T00:25:00.000Z')
          }
        ]
      });
    getLatestLastActiveByUserIdsMock.mockResolvedValueOnce({
      'user-1': '2026-03-03T00:20:00.000Z'
    });

    const response = await updateUserDirect(
      {
        id: 'user-1',
        json: '{"disabled":true}'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(deleteAllSessionsForUserMock).toHaveBeenCalledWith('user-1');
    expect(parseJson(response.json)).toEqual({
      user: {
        id: 'user-1',
        email: 'user1@example.com',
        emailConfirmed: true,
        admin: false,
        organizationIds: ['org-1'],
        createdAt: '2026-03-03T00:00:00.000Z',
        lastActiveAt: '2026-03-03T00:20:00.000Z',
        accounting: {
          totalPromptTokens: 8,
          totalCompletionTokens: 2,
          totalTokens: 10,
          requestCount: 1,
          lastUsedAt: '2026-03-03T00:25:00.000Z'
        },
        disabled: true,
        disabledAt: '2026-03-03T00:30:00.000Z',
        disabledBy: 'admin-root',
        markedForDeletionAt: null,
        markedForDeletionBy: null
      }
    });
  });

  it('rolls back and returns not found when organizationIds include missing org', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });
    queryMock
      .mockResolvedValueOnce({ rowCount: null })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'user-1',
            email: 'user1@example.com',
            email_confirmed: true,
            admin: false,
            disabled: false,
            disabled_at: null,
            disabled_by: null,
            marked_for_deletion_at: null,
            marked_for_deletion_by: null
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ personal_organization_id: 'org-personal' }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'org-1' }]
      })
      .mockResolvedValueOnce({ rowCount: null });

    await expect(
      updateUserDirect(
        {
          id: 'user-1',
          json: '{"organizationIds":["org-1","org-missing"]}'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });

    expect(queryMock).toHaveBeenCalledWith('ROLLBACK');
  });
});
