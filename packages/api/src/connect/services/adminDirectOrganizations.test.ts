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
    throw new Error('Expected JSON object');
  }
  return parsed;
}

describe('adminDirectOrganizations', () => {
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

  it('lists organizations for root admin without scope filter', async () => {
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
          id: 'org-1',
          name: 'Org One',
          description: null,
          created_at: new Date('2026-03-03T00:00:00.000Z'),
          updated_at: new Date('2026-03-03T00:05:00.000Z')
        }
      ]
    });

    const response = await listOrganizationsDirect(
      { organizationId: '' },
      {
        requestHeader: new Headers()
      }
    );

    expect(requireScopedAdminAccessMock).toHaveBeenCalledWith(
      '/admin/organizations',
      expect.any(Headers)
    );
    expect(parseJson(response.json)).toEqual({
      organizations: [
        {
          id: 'org-1',
          name: 'Org One',
          description: null,
          createdAt: '2026-03-03T00:00:00.000Z',
          updatedAt: '2026-03-03T00:05:00.000Z'
        }
      ]
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
    const call = queryMock.mock.calls[0];
    expect(call?.[1]).toBeUndefined();
  });

  it('rejects listOrganizations for inaccessible scoped organization', async () => {
    await expect(
      listOrganizationsDirect(
        { organizationId: 'org-2' },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns not found when organization does not exist', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      getOrganizationDirect(
        { id: 'org-missing' },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('requires root admin for createOrganization', async () => {
    await expect(
      createOrganizationDirect(
        { json: '{"name":"Org"}' },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects createOrganization when name is missing', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });

    await expect(
      createOrganizationDirect(
        { json: '{}' },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('maps duplicate createOrganization writes to AlreadyExists', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });
    queryMock.mockRejectedValueOnce(
      Object.assign(
        new Error('duplicate key value violates unique constraint'),
        {
          code: '23505'
        }
      )
    );

    await expect(
      createOrganizationDirect(
        { json: '{"name":"Org"}' },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('rejects updateOrganization when no fields are provided', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });

    await expect(
      updateOrganizationDirect(
        {
          id: 'org-1',
          json: '{}'
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

  it('returns deleted false when deleting unknown organization', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    const response = await deleteOrganizationDirect(
      {
        id: 'org-unknown'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({ deleted: false });
  });

  it('rejects deleting personal organizations', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-root',
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });
    queryMock.mockResolvedValueOnce({
      rows: [{ is_personal: true }]
    });

    await expect(
      deleteOrganizationDirect(
        {
          id: 'org-personal'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns organization users for accessible organizations', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'user-1',
            email: 'user1@example.com',
            joined_at: new Date('2026-03-03T00:15:00.000Z')
          }
        ]
      });

    const response = await getOrganizationUsersDirect(
      {
        id: 'org-1'
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
          joinedAt: '2026-03-03T00:15:00.000Z'
        }
      ]
    });
  });

  it('returns organization groups for accessible organizations', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'group-1',
            name: 'Engineering',
            description: null,
            member_count: 2
          }
        ]
      });

    const response = await getOrganizationGroupsDirect(
      {
        id: 'org-1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      groups: [
        {
          id: 'group-1',
          name: 'Engineering',
          description: null,
          memberCount: 2
        }
      ]
    });
  });
});
