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
  createGroupDirect,
  deleteGroupDirect,
  updateGroupDirect
} from './adminDirectGroupMutations.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('adminDirectGroupMutations error branches', () => {
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

  it('rejects createGroup when payload is missing required fields', async () => {
    await expect(
      createGroupDirect(
        {},
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('rejects createGroup when organization does not exist', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

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
      code: Code.NotFound
    });
  });

  it('maps missing insert rows in createGroup to Internal', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rows: []
      });

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
      code: Code.Internal
    });
  });

  it('rejects createGroup when organization id is missing', async () => {
    await expect(
      createGroupDirect(
        {
          name: 'Engineering'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('rejects createGroup when payload is empty', async () => {
    await expect(
      createGroupDirect({}, { requestHeader: new Headers() })
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('normalizes blank createGroup descriptions to null', async () => {
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
        organizationId: 'org-1',
        description: '   '
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(JSON.parse(response.json)).toEqual({
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

  it('maps unknown createGroup Error failures to Internal', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'org-1' }]
      })
      .mockRejectedValueOnce(new Error('database error'));

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
      code: Code.Internal
    });
  });

  it('rejects updateGroup when name is blank', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ organization_id: 'org-1' }]
    });

    await expect(
      updateGroupDirect(
        {
          id: 'group-1',
          name: '   '
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('rejects updateGroup when target organization id is blank', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ organization_id: 'org-1' }]
    });

    await expect(
      updateGroupDirect(
        {
          id: 'group-1',
          organizationId: '   '
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('rejects updateGroup when new organization is missing', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    await expect(
      updateGroupDirect(
        {
          id: 'group-1',
          organizationId: 'org-2'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('rejects updateGroup when new organization is inaccessible', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'org-2' }]
      });

    await expect(
      updateGroupDirect(
        {
          id: 'group-1',
          organizationId: 'org-2'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('maps duplicate updateGroup writes to AlreadyExists', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
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
      updateGroupDirect(
        {
          id: 'group-1',
          name: 'Engineering'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.AlreadyExists
    });
  });

  it('returns not found when updateGroup target group is missing', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      updateGroupDirect(
        {
          id: 'missing-group',
          name: 'Engineering'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('updates group for allowed organization transfer and null description', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'admin-1',
      adminAccess: {
        isRootAdmin: false,
        organizationIds: ['org-1', 'org-2']
      }
    });

    queryMock
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'org-2' }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'group-1',
            organization_id: 'org-2',
            name: 'Engineering',
            description: null,
            created_at: new Date('2026-03-03T00:00:00.000Z'),
            updated_at: new Date('2026-03-03T00:01:00.000Z')
          }
        ]
      });

    const response = await updateGroupDirect(
      {
        id: 'group-1',
        organizationId: 'org-2',
        description: null
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(JSON.parse(response.json)).toEqual({
      group: {
        id: 'group-1',
        organizationId: 'org-2',
        name: 'Engineering',
        description: null,
        createdAt: '2026-03-03T00:00:00.000Z',
        updatedAt: '2026-03-03T00:01:00.000Z'
      }
    });
  });

  it('returns not found when updateGroup update result has no row', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({
        rows: []
      });

    await expect(
      updateGroupDirect(
        {
          id: 'group-1',
          name: 'Engineering'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('maps unknown updateGroup Error failures to Internal', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ organization_id: 'org-1' }]
      })
      .mockRejectedValueOnce(new Error('database error'));

    await expect(
      updateGroupDirect(
        {
          id: 'group-1',
          name: 'Engineering'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('returns not found when deleteGroup target does not exist', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      deleteGroupDirect(
        {
          id: 'group-missing'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns forbidden when deleteGroup organization is inaccessible', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ organization_id: 'org-2' }]
    });

    await expect(
      deleteGroupDirect(
        {
          id: 'group-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });
});
