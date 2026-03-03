import { Code } from '@connectrpc/connect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticateMock, resolveOrganizationMembershipMock } = vi.hoisted(
  () => ({
    authenticateMock: vi.fn(),
    resolveOrganizationMembershipMock: vi.fn()
  })
);

vi.mock('./connectRequestAuth.js', () => ({
  authenticate: (...args: unknown[]) => authenticateMock(...args),
  resolveOrganizationMembership: (...args: unknown[]) =>
    resolveOrganizationMembershipMock(...args)
}));

import { requireMlsClaims } from './mlsDirectAuth.js';

describe('mlsDirectAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateMock.mockReset();
    resolveOrganizationMembershipMock.mockReset();
    authenticateMock.mockResolvedValue({
      ok: true,
      claims: { sub: 'user-1' }
    });
    resolveOrganizationMembershipMock.mockResolvedValue({
      ok: true,
      organizationId: null
    });
  });

  it('returns claims when auth and membership checks pass', async () => {
    const claims = await requireMlsClaims('/mls/key-packages', new Headers());
    expect(claims).toEqual({ sub: 'user-1' });
  });

  it('maps auth failures to connect errors', async () => {
    authenticateMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: 'Unauthorized'
    });

    await expect(
      requireMlsClaims('/mls/key-packages', new Headers())
    ).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('maps org membership failures to connect errors', async () => {
    resolveOrganizationMembershipMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Not a member of the specified organization'
    });

    await expect(
      requireMlsClaims('/mls/key-packages', new Headers())
    ).rejects.toMatchObject({
      code: Code.PermissionDenied
    });
  });
});
