import { Code } from '@connectrpc/connect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticateMock, resolveAdminAccessMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  resolveAdminAccessMock: vi.fn()
}));

vi.mock('./connectRequestAuth.js', () => ({
  authenticate: (...args: unknown[]) => authenticateMock(...args),
  resolveAdminAccess: (...args: unknown[]) => resolveAdminAccessMock(...args)
}));

import {
  requireAdminSession,
  requireScopedAdminAccess
} from './adminDirectAuth.js';

describe('adminDirectAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateMock.mockResolvedValue({
      ok: true,
      claims: { sub: 'user-1' },
      session: { userId: 'user-1', admin: true }
    });
    resolveAdminAccessMock.mockResolvedValue({
      ok: true,
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });
  });

  it('returns caller sub for admin session paths', async () => {
    resolveAdminAccessMock.mockResolvedValueOnce({
      ok: true,
      adminAccess: null
    });

    await expect(
      requireAdminSession('/admin/postgres/info', new Headers())
    ).resolves.toEqual({
      sub: 'user-1'
    });
  });

  it('maps auth and admin access failures to connect errors', async () => {
    authenticateMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: 'Unauthorized'
    });

    await expect(
      requireAdminSession('/admin/postgres/info', new Headers())
    ).rejects.toMatchObject({
      code: Code.Unauthenticated
    });

    authenticateMock.mockResolvedValueOnce({
      ok: true,
      claims: { sub: 'user-1' },
      session: { userId: 'user-1', admin: false }
    });
    resolveAdminAccessMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden'
    });

    await expect(
      requireAdminSession('/admin/postgres/info', new Headers())
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('requires non-null adminAccess for scoped admin paths', async () => {
    resolveAdminAccessMock.mockResolvedValueOnce({
      ok: true,
      adminAccess: null
    });

    await expect(
      requireScopedAdminAccess('/admin/context', new Headers())
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });

  it('returns scoped access when available', async () => {
    resolveAdminAccessMock.mockResolvedValueOnce({
      ok: true,
      adminAccess: {
        isRootAdmin: false,
        organizationIds: ['org-1', 'org-2']
      }
    });

    await expect(
      requireScopedAdminAccess('/admin/context', new Headers())
    ).resolves.toEqual({
      sub: 'user-1',
      adminAccess: {
        isRootAdmin: false,
        organizationIds: ['org-1', 'org-2']
      }
    });
  });
});
