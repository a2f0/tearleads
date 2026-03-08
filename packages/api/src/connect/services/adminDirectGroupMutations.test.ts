import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  connectMock,
  getPoolMock,
  queryMock,
  releaseMock,
  requireScopedAdminAccessMock
} = vi.hoisted(() => ({
  connectMock: vi.fn(),
  getPoolMock: vi.fn(),
  queryMock: vi.fn(),
  releaseMock: vi.fn(),
  requireScopedAdminAccessMock: vi.fn()
}));

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
  addGroupMemberDirect,
  createGroupDirect,
  deleteGroupDirect,
  removeGroupMemberDirect,
  updateGroupDirect
} from './adminDirectGroupMutations.js';

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

describe('adminDirectGroupMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectMock.mockReset();
    queryMock.mockReset();
    getPoolMock.mockReset();
    releaseMock.mockReset();
    requireScopedAdminAccessMock.mockReset();

    connectMock.mockResolvedValue({
      query: queryMock,
      release: releaseMock
    });
    getPoolMock.mockResolvedValue({
      query: queryMock,
      connect: connectMock
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

  it('creates a group when request is valid and scoped organization is accessible', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'group-1',
            organization_id: 'org-1',
            name: 'Engineering',
            description: null,
            created_at: new Date('2026-03-03T00:00:00.000Z'),
            updated_at: new Date('2026-03-03T00:00:00.000Z')
          }
        ]
      });

    const response = await createGroupDirect(
      {
        name: 'Engineering',
        organizationId: 'org-1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(requireScopedAdminAccessMock).toHaveBeenCalledWith(
      '/admin/groups',
      expect.any(Headers)
    );
    expect(parseJson(response.json)).toEqual({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Engineering',
        description: null,
        createdAt: '2026-03-03T00:00:00.000Z',
        updatedAt: '2026-03-03T00:00:00.000Z'
      }
    });
  });

  it('rejects createGroup when name is missing', async () => {
    await expect(
      createGroupDirect(
        {
          organizationId: 'org-1'
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

  it('rejects createGroup when requested organization is inaccessible', async () => {
    await expect(
      createGroupDirect(
        {
          name: 'Engineering',
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

  it('maps duplicate group name conflicts to AlreadyExists', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'org-1' }]
      })
      .mockRejectedValueOnce(
        Object.assign(
          new Error('duplicate key value violates unique constraint'),
          {
            code: '23505'
          }
        )
      );

    await expect(
      createGroupDirect(
        {
          name: 'Engineering',
          organizationId: 'org-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('updates a group when there are valid changes', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'group-1',
            organization_id: 'org-1',
            name: 'Product',
            description: 'Core',
            created_at: new Date('2026-03-03T00:00:00.000Z'),
            updated_at: new Date('2026-03-03T00:05:00.000Z')
          }
        ]
      });

    const response = await updateGroupDirect(
      {
        id: 'group-1',
        name: 'Product',
        description: 'Core'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Product',
        description: 'Core',
        createdAt: '2026-03-03T00:00:00.000Z',
        updatedAt: '2026-03-03T00:05:00.000Z'
      }
    });
  });

  it('rejects updateGroup when no fields are provided', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ organization_id: 'org-1' }]
    });

    await expect(
      updateGroupDirect(
        {
          id: 'group-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('rejects updateGroup when current group is inaccessible', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ organization_id: 'org-2' }]
    });

    await expect(
      updateGroupDirect(
        {
          id: 'group-1',
          name: 'Product'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('deletes a group and returns deleted state', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rowCount: 1
      });

    const response = await deleteGroupDirect(
      {
        id: 'group-1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      deleted: true
    });
  });

  it('adds a group member when group and user are valid', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rowCount: 1
      });

    const response = await addGroupMemberDirect(
      {
        id: 'group-1',
        userId: 'user-1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      added: true
    });
  });

  it('rejects addGroupMember when user does not exist', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rowCount: 0
      });

    await expect(
      addGroupMemberDirect(
        {
          id: 'group-1',
          userId: 'missing-user'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('maps duplicate addGroupMember writes to AlreadyExists', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rowCount: 1
      })
      .mockRejectedValueOnce(
        Object.assign(
          new Error('duplicate key value violates unique constraint'),
          {
            code: '23505'
          }
        )
      )
      .mockResolvedValueOnce({
        rowCount: 1
      });

    await expect(
      addGroupMemberDirect(
        {
          id: 'group-1',
          userId: 'user-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('removes a group member and returns removed state', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rowCount: 1
      });

    const response = await removeGroupMemberDirect(
      {
        groupId: 'group-1',
        userId: 'user-2'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      removed: true
    });
  });

  it('rejects removeGroupMember when group cannot be found', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      removeGroupMemberDirect(
        {
          groupId: 'missing-group',
          userId: 'user-2'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });
});
