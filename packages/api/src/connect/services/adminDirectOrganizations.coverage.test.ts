import { Code, ConnectError } from '@connectrpc/connect';
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
  createOrganizationDirect,
  deleteOrganizationDirect,
  getOrganizationDirect,
  getOrganizationGroupsDirect,
  getOrganizationUsersDirect,
  listOrganizationsDirect,
  updateOrganizationDirect
} from './adminDirectOrganizations.js';

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

    expect(parseJson(response.json)).toEqual({
      organizations: [
        {
          id: 'org-1',
          name: 'Org One',
          description: null,
          createdAt: '2026-03-03T01:00:00.000Z',
          updatedAt: '2026-03-03T01:05:00.000Z'
        }
      ]
    });

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

  it('rejects createOrganization with invalid JSON body', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });

    await expect(
      createOrganizationDirect({ json: '{' }, { requestHeader: new Headers() })
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('rejects createOrganization when JSON is not an object payload', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });

    await expect(
      createOrganizationDirect({ json: '[]' }, { requestHeader: new Headers() })
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('creates organization and normalizes non-string description to null', async () => {
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
      { json: '{"name":"Org New","description":123}' },
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toEqual({
      organization: {
        id: 'org-new',
        name: 'Org New',
        description: null,
        createdAt: '2026-03-03T01:30:00.000Z',
        updatedAt: '2026-03-03T01:30:00.000Z'
      }
    });
  });

  it('returns internal when createOrganization insert returns no rows', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      createOrganizationDirect(
        { json: '{"name":"Org"}' },
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
        { json: '{"name":"Org"}' },
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
        { id: 'org-1', json: '{"name":" "}' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('updates organization with non-string description normalized to null', async () => {
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
      { id: 'org-1', json: '{"description":123}' },
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toEqual({
      organization: {
        id: 'org-1',
        name: 'Org One',
        description: null,
        createdAt: '2026-03-03T01:00:00.000Z',
        updatedAt: '2026-03-03T01:45:00.000Z'
      }
    });
  });

  it('returns not found when updateOrganization affects no rows', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: { isRootAdmin: true, organizationIds: [] }
    });
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      updateOrganizationDirect(
        { id: 'org-missing', json: '{"name":"next"}' },
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
        { id: 'org-1', json: '{"name":"dup"}' },
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
        { id: 'org-1', json: '{"name":"next"}' },
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

    expect(parseJson(response.json)).toEqual({ deleted: true });
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
