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

vi.mock('./adminDirectAuth.js', () => ({
  requireScopedAdminAccess: (...args: unknown[]) =>
    requireScopedAdminAccessMock(...args)
}));

import { getContextDirect } from './adminDirectContext.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('adminDirectContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPoolMock.mockReset();
    requireScopedAdminAccessMock.mockReset();

    getPoolMock.mockResolvedValue({
      query: queryMock
    });
    requireScopedAdminAccessMock.mockResolvedValue({
      sub: 'user-1',
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('returns full organization scope for root admins', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 'org-1', name: 'Org One' },
        { id: 'org-2', name: 'Org Two' }
      ]
    });

    const response = await getContextDirect(
      {},
      {
        requestHeader: new Headers()
      }
    );

    expect(getPoolMock).toHaveBeenCalledWith('read');
    expect(requireScopedAdminAccessMock).toHaveBeenCalledWith(
      '/admin/context',
      expect.any(Headers)
    );
    expect(response).toMatchObject({
      isRootAdmin: true,
      organizations: [
        { id: 'org-1', name: 'Org One' },
        { id: 'org-2', name: 'Org Two' }
      ]
    });
    expect(response.defaultOrganizationId).toBeUndefined();
  });

  it('returns first org as default for org admins', async () => {
    requireScopedAdminAccessMock.mockResolvedValueOnce({
      sub: 'user-1',
      adminAccess: {
        isRootAdmin: false,
        organizationIds: ['org-2']
      }
    });
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 'org-2', name: 'Org Two' },
        { id: 'org-3', name: 'Org Three' }
      ]
    });

    const response = await getContextDirect(
      {},
      {
        requestHeader: new Headers()
      }
    );

    expect(response).toMatchObject({
      isRootAdmin: false,
      organizations: [
        { id: 'org-2', name: 'Org Two' },
        { id: 'org-3', name: 'Org Three' }
      ],
      defaultOrganizationId: 'org-2'
    });
  });

  it('maps unexpected load errors to internal errors', async () => {
    getPoolMock.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      getContextDirect(
        {},
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });
});
