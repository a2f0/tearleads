import { Code } from '@connectrpc/connect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticateMock, resolveOrganizationMembershipMock } = vi.hoisted(
  () => ({
    authenticateMock: vi.fn(),
    resolveOrganizationMembershipMock: vi.fn()
  })
);
const { getPostgresPoolMock, queryMock } = vi.hoisted(() => ({
  getPostgresPoolMock: vi.fn(),
  queryMock: vi.fn()
}));

vi.mock('./legacyRouteProxyAuth.js', () => ({
  authenticate: (...args: unknown[]) => authenticateMock(...args),
  resolveOrganizationMembership: (...args: unknown[]) =>
    resolveOrganizationMembershipMock(...args)
}));
vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

import { requireVfsClaims } from './vfsDirectAuth.js';

describe('requireVfsClaims', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateMock.mockResolvedValue({
      ok: true,
      claims: {
        sub: 'user-1'
      }
    });
    resolveOrganizationMembershipMock.mockResolvedValue({
      ok: true,
      organizationId: null
    });
    queryMock.mockResolvedValue({
      rows: [{ personal_organization_id: 'org-personal' }]
    });
    getPostgresPoolMock.mockResolvedValue({
      query: queryMock
    });
  });

  it('returns claims with personal organization fallback', async () => {
    const headers = new Headers({
      authorization: 'Bearer token'
    });

    await expect(requireVfsClaims('/vfs/keys/me', headers)).resolves.toEqual({
      sub: 'user-1',
      organizationId: 'org-personal'
    });

    expect(authenticateMock).toHaveBeenCalledWith(headers);
    expect(resolveOrganizationMembershipMock).toHaveBeenCalledWith(
      '/vfs/keys/me',
      headers,
      'user-1'
    );
  });

  it('prefers resolved organization header membership', async () => {
    resolveOrganizationMembershipMock.mockResolvedValueOnce({
      ok: true,
      organizationId: 'org-header'
    });

    await expect(
      requireVfsClaims('/vfs/keys/me', new Headers())
    ).resolves.toEqual({
      sub: 'user-1',
      organizationId: 'org-header'
    });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('requires explicitly declared organization for write requests', async () => {
    const promise = requireVfsClaims('/vfs/register', new Headers(), {
      requireDeclaredOrganization: true
    });

    await expect(promise).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    await expect(promise).rejects.toThrow(
      /X-Organization-Id header is required for VFS write requests/u
    );

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('accepts declared organization for write requests', async () => {
    resolveOrganizationMembershipMock.mockResolvedValueOnce({
      ok: true,
      organizationId: 'org-header'
    });

    await expect(
      requireVfsClaims('/vfs/register', new Headers(), {
        requireDeclaredOrganization: true
      })
    ).resolves.toEqual({
      sub: 'user-1',
      organizationId: 'org-header'
    });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('maps auth failures to connect errors', async () => {
    authenticateMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: 'Unauthorized'
    });

    const promise = requireVfsClaims('/vfs/keys/me', new Headers());
    await expect(promise).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
    await expect(promise).rejects.toThrow(/Unauthorized/u);

    expect(resolveOrganizationMembershipMock).not.toHaveBeenCalled();
  });

  it('maps membership failures to connect errors', async () => {
    resolveOrganizationMembershipMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Not a member of the specified organization'
    });

    const promise = requireVfsClaims('/vfs/keys/me', new Headers());
    await expect(promise).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
    await expect(promise).rejects.toThrow(
      /Not a member of the specified organization/u
    );
  });

  it('rejects when no organization context can be resolved', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ personal_organization_id: null }]
    });

    const promise = requireVfsClaims('/vfs/keys/me', new Headers());
    await expect(promise).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
    await expect(promise).rejects.toThrow(
      /Organization context is required for VFS access/u
    );
  });
});
