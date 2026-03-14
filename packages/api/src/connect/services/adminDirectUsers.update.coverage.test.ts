import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deleteAllSessionsForUserMock = vi.fn();
const getLatestLastActiveByUserIdsMock = vi.fn();
const getPoolMock = vi.fn();
const queryMock = vi.fn();
const requireScopedAdminAccessMock = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args)
}));

vi.mock('../../lib/sessions.js', () => ({
  deleteAllSessionsForUser: (...args: unknown[]) =>
    deleteAllSessionsForUserMock(...args),
  getLatestLastActiveByUserIds: (...args: unknown[]) =>
    getLatestLastActiveByUserIdsMock(...args)
}));

vi.mock('./adminDirectAuth.js', () => ({
  requireScopedAdminAccess: (...args: unknown[]) =>
    requireScopedAdminAccessMock(...args)
}));

import { updateUserDirect } from './adminDirectUsers.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('adminDirectUsers update coverage branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPoolMock.mockReset();
    requireScopedAdminAccessMock.mockReset();
    getLatestLastActiveByUserIdsMock.mockReset();
    deleteAllSessionsForUserMock.mockReset();

    getPoolMock.mockResolvedValue({ query: queryMock });
    requireScopedAdminAccessMock.mockResolvedValue({
      sub: 'admin-root',
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
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

  it('rejects updateUser when parsed payload has no editable fields', async () => {
    await expect(
      updateUserDirect({ id: 'user-1' }, { requestHeader: new Headers() })
    ).rejects.toMatchObject({ code: Code.InvalidArgument });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rolls back when update target user does not exist after update clause path', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: null })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: null });

    await expect(
      updateUserDirect(
        { id: 'missing-user', email: 'next@example.com' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.NotFound });

    expect(queryMock).toHaveBeenCalledWith('ROLLBACK');
  });

  it('rolls back when update target user does not exist in select-only path', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: null })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: null });

    await expect(
      updateUserDirect(
        { id: 'missing-user', organizationIds: ['org-1'] },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.NotFound });

    expect(queryMock).toHaveBeenCalledWith('ROLLBACK');
  });

  it('updates user with disabled=false and markedForDeletion=false branches', async () => {
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
      .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
      .mockResolvedValueOnce({
        rows: [{ created_at: new Date('2026-03-03T02:15:00.000Z') }]
      })
      .mockResolvedValueOnce({ rowCount: null })
      .mockResolvedValueOnce({ rows: [] });

    const response = await updateUserDirect(
      { id: 'user-1', disabled: false, markedForDeletion: false },
      { requestHeader: new Headers() }
    );

    const updateSql = queryMock.mock.calls[1]?.[0];
    expect(typeof updateSql).toBe('string');
    expect(updateSql).toContain('"disabled_at" = NULL');
    expect(updateSql).toContain('"marked_for_deletion_at" = NULL');
    expect(deleteAllSessionsForUserMock).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      user: {
        id: 'user-1',
        email: 'user1@example.com',
        emailConfirmed: true,
        admin: false,
        organizationIds: ['org-1'],
        createdAt: '2026-03-03T02:15:00.000Z',
        accounting: {
          totalPromptTokens: 0n,
          totalCompletionTokens: 0n,
          totalTokens: 0n,
          requestCount: 0n
        },
        disabled: false
      }
    });
    expect(response.user?.lastActiveAt).toBeUndefined();
    expect(response.user?.accounting?.lastUsedAt).toBeUndefined();
    expect(response.user?.disabledAt).toBeUndefined();
    expect(response.user?.disabledBy).toBeUndefined();
    expect(response.user?.markedForDeletionAt).toBeUndefined();
    expect(response.user?.markedForDeletionBy).toBeUndefined();
  });

  it('updates organization memberships and preserves personal organization', async () => {
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
        rows: [{ id: 'org-2' }, { id: 'org-personal' }]
      })
      .mockResolvedValueOnce({ rowCount: null })
      .mockResolvedValueOnce({ rowCount: null })
      .mockResolvedValueOnce({
        rows: [
          { organization_id: 'org-2' },
          { organization_id: 'org-personal' }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ created_at: new Date('2026-03-03T02:20:00.000Z') }]
      })
      .mockResolvedValueOnce({ rowCount: null })
      .mockResolvedValueOnce({ rows: [] });

    const response = await updateUserDirect(
      { id: 'user-1', organizationIds: ['org-2', 'org-2'] },
      { requestHeader: new Headers() }
    );

    const insertCall = queryMock.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('INSERT INTO user_organizations')
    );
    const organizationLookupCall = queryMock.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('SELECT id FROM organizations')
    );
    expect(organizationLookupCall?.[0]).toContain(
      'SELECT id FROM organizations WHERE id = ANY($1::uuid[])'
    );
    expect(insertCall?.[0]).toContain('FROM unnest($2::uuid[]) AS organization_id');
    expect(insertCall?.[1]).toEqual([
      'user-1',
      ['org-2', 'org-personal'],
      'org-personal'
    ]);
    expect(response).toMatchObject({
      user: {
        id: 'user-1',
        email: 'user1@example.com',
        emailConfirmed: true,
        admin: false,
        organizationIds: ['org-2', 'org-personal'],
        createdAt: '2026-03-03T02:20:00.000Z',
        accounting: {
          totalPromptTokens: 0n,
          totalCompletionTokens: 0n,
          totalTokens: 0n,
          requestCount: 0n
        },
        disabled: false
      }
    });
    expect(response.user?.lastActiveAt).toBeUndefined();
    expect(response.user?.accounting?.lastUsedAt).toBeUndefined();
    expect(response.user?.disabledAt).toBeUndefined();
    expect(response.user?.disabledBy).toBeUndefined();
    expect(response.user?.markedForDeletionAt).toBeUndefined();
    expect(response.user?.markedForDeletionBy).toBeUndefined();
  });

  it('returns internal and rolls back when personal organization is missing', async () => {
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
      .mockResolvedValueOnce({ rows: [{ personal_organization_id: null }] })
      .mockResolvedValueOnce({ rowCount: null });

    await expect(
      updateUserDirect(
        { id: 'user-1', organizationIds: ['org-2'] },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });

    expect(queryMock).toHaveBeenCalledWith('ROLLBACK');
  });

  it('maps unknown update failures to internal and attempts rollback', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: null })
      .mockRejectedValueOnce(new Error('update write failed'))
      .mockResolvedValueOnce({ rowCount: null });

    await expect(
      updateUserDirect(
        { id: 'user-1', email: 'next@example.com' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });

    expect(queryMock).toHaveBeenCalledWith('ROLLBACK');
  });

  it('logs rollback errors but still surfaces update failure', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: null })
      .mockRejectedValueOnce(new Error('update write failed'))
      .mockRejectedValueOnce(new Error('rollback failed'));

    await expect(
      updateUserDirect(
        { id: 'user-1', email: 'next@example.com' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to rollback user update:',
      expect.any(Error)
    );
  });
});
