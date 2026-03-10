import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn();
const getPoolMock = vi.fn();
const queryMock = vi.fn();
const releaseMock = vi.fn();
const requireScopedAdminAccessMock = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args)
}));

vi.mock('./adminDirectAuth.js', () => ({
  requireScopedAdminAccess: (...args: unknown[]) =>
    requireScopedAdminAccessMock(...args)
}));

import {
  addGroupMemberDirect,
  removeGroupMemberDirect
} from './adminDirectGroupMutations.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('adminDirectGroupMutations member errors', () => {
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

  it('rejects addGroupMember with empty userId', async () => {
    await expect(
      addGroupMemberDirect(
        {
          id: 'group-1',
          userId: ''
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns forbidden when addGroupMember group is inaccessible', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ organization_id: 'org-2' }]
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
      code: Code.PermissionDenied
    });
  });

  it('returns not found when addGroupMember group is missing', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      addGroupMemberDirect(
        {
          id: 'group-missing',
          userId: 'user-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('maps unknown addGroupMember failures to Internal', async () => {
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
      .mockRejectedValueOnce('boom')
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
      code: Code.Internal
    });
  });

  it('maps addGroupMember Error failures to Internal', async () => {
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
      .mockRejectedValueOnce(new Error('database error'))
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
      code: Code.Internal
    });
  });

  it('returns forbidden when removeGroupMember group is inaccessible', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ organization_id: 'org-2' }]
    });

    await expect(
      removeGroupMemberDirect(
        {
          groupId: 'group-1',
          userId: 'user-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('maps unknown removeGroupMember Error failures to Internal', async () => {
    getPoolMock.mockRejectedValueOnce(new Error('database error'));

    await expect(
      removeGroupMemberDirect(
        {
          groupId: 'group-1',
          userId: 'user-1'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('maps unknown removeGroupMember failures to Internal', async () => {
    getPoolMock.mockRejectedValueOnce('boom');

    await expect(
      removeGroupMemberDirect(
        {
          groupId: 'group-1',
          userId: 'user-1'
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
