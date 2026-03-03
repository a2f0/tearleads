import { Code } from '@connectrpc/connect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticateMock, resolveOrganizationMembershipMock } = vi.hoisted(
  () => ({
    authenticateMock: vi.fn(),
    resolveOrganizationMembershipMock: vi.fn()
  })
);

vi.mock('./legacyRouteProxyAuth.js', () => ({
  authenticate: (...args: unknown[]) => authenticateMock(...args),
  resolveOrganizationMembership: (...args: unknown[]) =>
    resolveOrganizationMembershipMock(...args)
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
  });

  it('returns claims when auth and membership checks pass', async () => {
    const headers = new Headers({
      authorization: 'Bearer token'
    });

    await expect(requireVfsClaims('/vfs/keys/me', headers)).resolves.toEqual({
      sub: 'user-1'
    });

    expect(authenticateMock).toHaveBeenCalledWith(headers);
    expect(resolveOrganizationMembershipMock).toHaveBeenCalledWith(
      '/vfs/keys/me',
      headers,
      'user-1'
    );
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
});
