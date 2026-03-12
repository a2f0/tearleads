import { Code, ConnectError } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPoolMock = vi.fn();
const queryMock = vi.fn();
const requireScopedAdminAccessMock = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args)
}));

vi.mock('./adminDirectAuth.js', () => ({
  requireScopedAdminAccess: (...args: unknown[]) =>
    requireScopedAdminAccessMock(...args)
}));

import {
  createOrganizationDirect,
  deleteOrganizationDirect,
  getOrganizationDirect,
  getOrganizationGroupsDirect,
  getOrganizationUsersDirect,
  listOrganizationsDirect,
  updateOrganizationDirect
} from './adminDirectOrganizations.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('adminDirectOrganizations coverage branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPoolMock.mockReset();
    requireScopedAdminAccessMock.mockReset();

    getPoolMock.mockResolvedValue({ query: queryMock });
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

  it('lists organizations for org-scoped admins without explicit filter', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'org-1',
          name: 'Org One',
          description: null,
          created_at: new Date('2026-03-03T01:00:00.000Z'),
          updated_at: new Date('2026-03-03T01:05:00.000Z')
        }
      ]
    });

    const response = await listOrganizationsDirect(
      { organizationId: '  ' },
      { requestHeader: new Headers() }
    );

    expect(response.organizations).toMatchObject([
      {
        id: 'org-1',
        name: 'Org One',
        createdAt: '2026-03-03T01:00:00.000Z',
        updatedAt: '2026-03-03T01:05:00.000Z'
      }
    ]);
    expect(response.organizations[0]?.description).toBeUndefined();

    const call = queryMock.mock.calls.at(-1);
    expect(call?.[1]).toEqual([['org-1']]);
  });

  it('lists organizations with explicit filter when scoped admin has access', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await listOrganizationsDirect(
      { organizationId: 'org-1' },
      { requestHeader: new Headers() }
    );

    const call = queryMock.mock.calls.at(-1);
    expect(call?.[1]).toEqual([['org-1']]);
  });

  it('preserves non-null organization descriptions in list responses', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'org-1',
          name: 'Org One',
          description: 'Primary org',
          created_at: new Date('2026-03-03T01:00:00.000Z'),
          updated_at: new Date('2026-03-03T01:05:00.000Z')
        }
      ]
    });

    const response = await listOrganizationsDirect(
      { organizationId: 'org-1' },
      { requestHeader: new Headers() }
    );

    expect(response.organizations[0]?.description).toBe('Primary org');
  });

  it('maps listOrganizations query errors to internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('read failed'));

    await expect(
      listOrganizationsDirect(
        { organizationId: '' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('rethrows ConnectError from listOrganizations query path', async () => {
    queryMock.mockRejectedValueOnce(
      new ConnectError('query forbidden', Code.PermissionDenied)
    );

    await expect(
      listOrganizationsDirect(
        { organizationId: '' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('rejects getOrganization when org is outside scoped access', async () => {
    await expect(
      getOrganizationDirect({ id: 'org-2' }, { requestHeader: new Headers() })
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('maps getOrganization query errors to internal', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });
    queryMock.mockRejectedValueOnce(new Error('select failed'));

    await expect(
      getOrganizationDirect({ id: 'org-1' }, { requestHeader: new Headers() })
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('creates organization and normalizes empty description to null', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'org-new',
          name: 'Org New',
          description: null,
          created_at: new Date('2026-03-03T01:30:00.000Z'),
          updated_at: new Date('2026-03-03T01:30:00.000Z')
        }
      ]
    });

    const response = await createOrganizationDirect(
      { name: 'Org New', description: '   ' },
      { requestHeader: new Headers() }
    );

    expect(response.organization).toMatchObject({
      id: 'org-new',
      name: 'Org New',
      createdAt: '2026-03-03T01:30:00.000Z',
      updatedAt: '2026-03-03T01:30:00.000Z'
    });
    expect(response.organization?.description).toBeUndefined();
  });

  it('returns internal when createOrganization insert returns no rows', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      createOrganizationDirect(
        { name: 'Org' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('maps generic createOrganization errors to internal', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });
    queryMock.mockRejectedValueOnce(new Error('insert failed'));

    await expect(
      createOrganizationDirect(
        { name: 'Org' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('rejects updateOrganization with empty name', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });

    await expect(
      updateOrganizationDirect(
        { id: 'org-1', name: ' ' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('updates organization with empty description normalized to null', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'org-1',
          name: 'Org One',
          description: null,
          created_at: new Date('2026-03-03T01:00:00.000Z'),
          updated_at: new Date('2026-03-03T01:45:00.000Z')
        }
      ]
    });

    const response = await updateOrganizationDirect(
      { id: 'org-1', description: '' },
      { requestHeader: new Headers() }
    );

    expect(response.organization).toMatchObject({
      id: 'org-1',
      name: 'Org One',
      createdAt: '2026-03-03T01:00:00.000Z',
      updatedAt: '2026-03-03T01:45:00.000Z'
    });
    expect(response.organization?.description).toBeUndefined();
  });

  it('returns not found when updateOrganization affects no rows', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      updateOrganizationDirect(
        { id: 'org-missing', name: 'next' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it('maps duplicate updateOrganization writes to AlreadyExists', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });
    queryMock.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: '23505' })
    );

    await expect(
      updateOrganizationDirect(
        { id: 'org-1', name: 'dup' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.AlreadyExists });
  });

  it('maps generic updateOrganization errors to internal', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });
    queryMock.mockRejectedValueOnce(new Error('update failed'));

    await expect(
      updateOrganizationDirect(
        { id: 'org-1', name: 'next' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('deletes organization and returns deleted true', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });
    queryMock
      .mockResolvedValueOnce({ rows: [{ is_personal: false }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const response = await deleteOrganizationDirect(
      { id: 'org-1' },
      { requestHeader: new Headers() }
    );

    expect(response.deleted).toBe(true);
  });

  it('maps deleteOrganization query errors to internal', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });
    queryMock.mockRejectedValueOnce(new Error('delete failed'));

    await expect(
      deleteOrganizationDirect(
        { id: 'org-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('rejects getOrganizationUsers when org is outside access scope', async () => {
    await expect(
      getOrganizationUsersDirect(
        { id: 'org-2' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('returns not found when getOrganizationUsers org does not exist', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      getOrganizationUsersDirect(
        { id: 'org-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it('maps getOrganizationUsers query errors to internal', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
      .mockRejectedValueOnce(new Error('users query failed'));

    await expect(
      getOrganizationUsersDirect(
        { id: 'org-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('rejects getOrganizationGroups when org is outside access scope', async () => {
    await expect(
      getOrganizationGroupsDirect(
        { id: 'org-2' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('returns not found when getOrganizationGroups org does not exist', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      getOrganizationGroupsDirect(
        { id: 'org-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it('maps getOrganizationGroups query errors to internal', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
      .mockRejectedValueOnce(new Error('groups query failed'));

    await expect(
      getOrganizationGroupsDirect(
        { id: 'org-1' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });
});
