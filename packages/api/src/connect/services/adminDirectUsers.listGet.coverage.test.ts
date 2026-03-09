import { Code, ConnectError } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getLatestLastActiveByUserIdsMock,
  getPoolMock,
  queryMock,
  requireScopedAdminAccessMock
} = vi.hoisted(() => ({
  getLatestLastActiveByUserIdsMock: vi.fn(),
  getPoolMock: vi.fn(),
  queryMock: vi.fn(),
  requireScopedAdminAccessMock: vi.fn()
}));

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args)
}));

vi.mock('../../lib/sessions.js', async () => {
  const actual = await vi.importActual<typeof import('../../lib/sessions.js')>(
    '../../lib/sessions.js'
  );

  return {
    ...actual,
    getLatestLastActiveByUserIds: (...args: unknown[]) =>
      getLatestLastActiveByUserIdsMock(...args)
  };
});

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

import { getUserDirect, listUsersDirect } from './adminDirectUsers.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('adminDirectUsers list/get coverage branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPoolMock.mockReset();
    requireScopedAdminAccessMock.mockReset();
    getLatestLastActiveByUserIdsMock.mockReset();

    getPoolMock.mockResolvedValue({ query: queryMock });
    requireScopedAdminAccessMock.mockResolvedValue({
      sub: 'admin-1',
      adminAccess: {
        isRootAdmin: false,
        organizationIds: ['org-1']
      }
    });
    getLatestLastActiveByUserIdsMock.mockResolvedValue({});

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('lists all users for root admins when organization filter is blank', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });
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
            created_at: new Date('2026-03-03T02:00:00.000Z'),
            organization_ids: ['org-1']
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });
    getLatestLastActiveByUserIdsMock.mockResolvedValueOnce({
      'user-1': '2026-03-03T02:05:00.000Z'
    });

    const response = await listUsersDirect(
      { organizationId: '   ' },
      { requestHeader: new Headers() }
    );

    const queryCall = queryMock.mock.calls[0];
    expect(queryCall?.[1]).toBeUndefined();
    expect(response).toMatchObject({
      users: [
        {
          id: 'user-1',
          email: 'user1@example.com',
          emailConfirmed: true,
          admin: false,
          organizationIds: ['org-1'],
          createdAt: '2026-03-03T02:00:00.000Z',
          lastActiveAt: '2026-03-03T02:05:00.000Z',
          accounting: {
            totalPromptTokens: 0n,
            totalCompletionTokens: 0n,
            totalTokens: 0n,
            requestCount: 0n
          },
          disabled: false
        }
      ]
    });
    expect(response.users[0]?.accounting?.lastUsedAt).toBeUndefined();
    expect(response.users[0]?.disabledAt).toBeUndefined();
    expect(response.users[0]?.disabledBy).toBeUndefined();
    expect(response.users[0]?.markedForDeletionAt).toBeUndefined();
    expect(response.users[0]?.markedForDeletionBy).toBeUndefined();
  });

  it('uses scoped organization list for non-root admins when filter is blank', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await listUsersDirect(
      { organizationId: '  ' },
      { requestHeader: new Headers() }
    );

    const queryCall = queryMock.mock.calls[0];
    expect(queryCall?.[1]).toEqual([['org-1']]);
    expect(response.users).toEqual([]);
  });

  it('maps listUsers query failures to internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('list failed'));

    await expect(
      listUsersDirect({ organizationId: '' }, { requestHeader: new Headers() })
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('rethrows ConnectError raised in listUsers enrichment path', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    getLatestLastActiveByUserIdsMock.mockRejectedValueOnce(
      new ConnectError('session lookup forbidden', Code.PermissionDenied)
    );

    await expect(
      listUsersDirect({ organizationId: '' }, { requestHeader: new Headers() })
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('returns user for root admins with accounting fallback to empty', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });
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
            created_at: new Date('2026-03-03T02:10:00.000Z'),
            organization_ids: ['org-1']
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });
    getLatestLastActiveByUserIdsMock.mockResolvedValueOnce({
      'user-1': '2026-03-03T02:12:00.000Z'
    });

    const response = await getUserDirect(
      { id: 'user-1' },
      { requestHeader: new Headers() }
    );

    const queryCall = queryMock.mock.calls[0];
    expect(queryCall?.[1]).toEqual(['user-1']);
    expect(response).toMatchObject({
      user: {
        id: 'user-1',
        email: 'user1@example.com',
        emailConfirmed: true,
        admin: false,
        organizationIds: ['org-1'],
        createdAt: '2026-03-03T02:10:00.000Z',
        lastActiveAt: '2026-03-03T02:12:00.000Z',
        accounting: {
          totalPromptTokens: 0n,
          totalCompletionTokens: 0n,
          totalTokens: 0n,
          requestCount: 0n
        },
        disabled: false
      }
    });
    expect(response.user?.accounting?.lastUsedAt).toBeUndefined();
    expect(response.user?.disabledAt).toBeUndefined();
    expect(response.user?.disabledBy).toBeUndefined();
    expect(response.user?.markedForDeletionAt).toBeUndefined();
    expect(response.user?.markedForDeletionBy).toBeUndefined();
  });

  it('maps getUser query failures to internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('read failed'));

    await expect(
      getUserDirect({ id: 'user-1' }, { requestHeader: new Headers() })
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('rethrows ConnectError raised while enriching getUser response', async () => {
    queryMock.mockResolvedValueOnce({
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
          created_at: new Date('2026-03-03T02:10:00.000Z'),
          organization_ids: ['org-1']
        }
      ]
    });
    getLatestLastActiveByUserIdsMock.mockRejectedValueOnce(
      new ConnectError('session backend unavailable', Code.Unavailable)
    );

    await expect(
      getUserDirect({ id: 'user-1' }, { requestHeader: new Headers() })
    ).rejects.toMatchObject({ code: Code.Unavailable });
  });
});
