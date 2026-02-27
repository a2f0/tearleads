import { type SeededUser, seedTestUser } from '@tearleads/api-test-utils';
import { getRecordedApiRequests, wasApiRequestMade } from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TOKEN_KEY } from '@/lib/authStorage';
import { getSharedTestContext } from '@/test/testContext';

// Mock analytics to capture logged event names
const mockLogApiEvent = vi.fn();
vi.mock('@/db/analytics', () => ({
  logApiEvent: (...args: unknown[]) => mockLogApiEvent(...args)
}));

const loadApi = async () => {
  const module = await import('./api');
  return module.api;
};

type RecordedApiRequest = ReturnType<typeof getRecordedApiRequests>[number];

const getRequestsFor = (
  method: string,
  pathname: string
): RecordedApiRequest[] =>
  getRecordedApiRequests().filter(
    (request) =>
      request.method === method.toUpperCase() && request.pathname === pathname
  );

const getRequestQuery = (request: RecordedApiRequest): Record<string, string> =>
  Object.fromEntries(new URL(request.url).searchParams.entries());

const expectSingleRequestQuery = (
  method: string,
  pathname: string,
  expectedQuery: Record<string, string>
): void => {
  const requests = getRequestsFor(method, pathname);
  expect(requests).toHaveLength(1);
  const [request] = requests;
  if (!request) {
    throw new Error(`Missing recorded request: ${method} ${pathname}`);
  }
  expect(getRequestQuery(request)).toEqual(expectedQuery);
};

let seededUser: SeededUser;

describe('api with msw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    localStorage.clear();
    const ctx = getSharedTestContext();
    seededUser = await seedTestUser(ctx, { admin: true });
    localStorage.setItem(AUTH_TOKEN_KEY, seededUser.accessToken);
    mockLogApiEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('routes vfs and ai requests through msw', async () => {
    const ctx = getSharedTestContext();

    // Create second user in a shared org for share operations
    const secondUser = await seedTestUser(ctx);
    const sharedOrgId = 'shared-org-vfs';
    await ctx.pool.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ($1, 'Shared Org', NOW(), NOW())`,
      [sharedOrgId]
    );
    await ctx.pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, joined_at)
       VALUES ($1, $2, NOW()), ($3, $2, NOW())`,
      [seededUser.userId, sharedOrgId, secondUser.userId]
    );

    // Create target org for org-share operations
    const targetOrgId = 'target-org-vfs';
    await ctx.pool.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ($1, 'Target Org', NOW(), NOW())`,
      [targetOrgId]
    );

    const api = await loadApi();

    // Setup keys first (real API returns 404 if keys don't exist)
    await api.vfs.setupKeys({
      publicEncryptionKey: 'public-encryption-key',
      publicSigningKey: 'public-signing-key',
      encryptedPrivateKeys: 'encrypted-private-keys',
      argon2Salt: 'argon2-salt'
    });
    await api.vfs.getMyKeys();

    // Register VFS item
    await api.vfs.register({
      id: 'item-1',
      objectType: 'file',
      encryptedSessionKey: 'encrypted-session-key'
    });

    // Share operations using real item and user IDs
    await api.vfs.getShares('item-1');
    const shareResponse = await api.vfs.createShare({
      itemId: 'item-1',
      shareType: 'user',
      targetId: secondUser.userId,
      permissionLevel: 'view',
      wrappedKey: {
        recipientUserId: secondUser.userId,
        recipientPublicKeyId: 'pk-user-2',
        keyEpoch: 2,
        encryptedKey: 'wrapped-key',
        senderSignature: 'sender-signature'
      }
    });
    const shareUuid = shareResponse.id.replace('share:', '');

    // Org share operations
    const orgShareResponse = await api.vfs.createOrgShare({
      itemId: 'item-1',
      sourceOrgId: sharedOrgId,
      targetOrgId: targetOrgId,
      permissionLevel: 'view'
    });
    const orgShareParts = orgShareResponse.id.split(':');
    const orgShareUuid = orgShareParts[orgShareParts.length - 1];
    expect(orgShareUuid).toBeTruthy();

    // Rekey while share is still active
    await api.vfs.rekeyItem('item-1', {
      reason: 'manual',
      newEpoch: 2,
      wrappedKeys: [
        {
          recipientUserId: secondUser.userId,
          recipientPublicKeyId: 'pk-user-2',
          keyEpoch: 2,
          encryptedKey: 'rekeyed-key',
          senderSignature: 'rekey-signature'
        }
      ]
    });

    // Update and delete shares
    await api.vfs.updateShare(shareUuid, { permissionLevel: 'edit' });
    await api.vfs.deleteShare(shareUuid);
    await api.vfs.deleteOrgShare(orgShareUuid ?? '');

    // Search share targets
    await api.vfs.searchShareTargets('test query', 'user');

    // AI usage (no FK-violating conversationId/messageId)
    await api.ai.recordUsage({
      modelId: 'mistralai/mistral-7b-instruct',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15
    });
    await api.ai.getUsage({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: '2025-01-01T00:00:00.000Z',
      limit: 10
    });
    await api.ai.getUsageSummary({
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    });

    expect(wasApiRequestMade('POST', '/vfs/keys')).toBe(true);
    expect(wasApiRequestMade('GET', '/vfs/keys/me')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/register')).toBe(true);
    expect(wasApiRequestMade('GET', '/vfs/items/item-1/shares')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/items/item-1/shares')).toBe(true);
    expect(wasApiRequestMade('PATCH', `/vfs/shares/${shareUuid}`)).toBe(true);
    expect(wasApiRequestMade('DELETE', `/vfs/shares/${shareUuid}`)).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/items/item-1/org-shares')).toBe(
      true
    );
    expect(wasApiRequestMade('DELETE', `/vfs/org-shares/${orgShareUuid}`)).toBe(
      true
    );
    expect(wasApiRequestMade('POST', '/vfs/items/item-1/rekey')).toBe(true);
    expect(wasApiRequestMade('GET', '/vfs/share-targets/search')).toBe(true);

    expect(wasApiRequestMade('POST', '/ai/usage')).toBe(true);
    expect(wasApiRequestMade('GET', '/ai/usage')).toBe(true);
    expect(wasApiRequestMade('GET', '/ai/usage/summary')).toBe(true);

    expectSingleRequestQuery('GET', '/vfs/share-targets/search', {
      q: 'test query',
      type: 'user'
    });
    expectSingleRequestQuery('GET', '/ai/usage', {
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: '2025-01-01T00:00:00.000Z',
      limit: '10'
    });
  });

  it('builds query-string variants through msw request metadata', async () => {
    const api = await loadApi();

    await api.admin.postgres.getRows('public', 'users', {
      limit: 10,
      offset: 20,
      sortColumn: 'email',
      sortDirection: 'desc'
    });
    await api.admin.postgres.getRows('public', 'users');

    // Redis getKeys: with params vs without
    await api.admin.redis.getKeys('5', 10);
    await api.admin.redis.getKeys();

    await api.ai.getUsage({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: '2025-01-01T00:00:00.000Z',
      limit: 25
    });
    await api.ai.getUsage();
    await api.ai.getUsageSummary({
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    });
    await api.ai.getUsageSummary();

    const postgresRowsRequests = getRequestsFor(
      'GET',
      '/admin/postgres/tables/public/users/rows'
    );
    expect(postgresRowsRequests).toHaveLength(2);
    expect(postgresRowsRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([
        {
          limit: '10',
          offset: '20',
          sortColumn: 'email',
          sortDirection: 'desc'
        },
        {}
      ])
    );

    const aiUsageRequests = getRequestsFor('GET', '/ai/usage');
    expect(aiUsageRequests).toHaveLength(2);
    expect(aiUsageRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([
        {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
          cursor: '2025-01-01T00:00:00.000Z',
          limit: '25'
        },
        {}
      ])
    );

    const aiUsageSummaryRequests = getRequestsFor('GET', '/ai/usage/summary');
    expect(aiUsageSummaryRequests).toHaveLength(2);
    expect(aiUsageSummaryRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([
        {
          startDate: '2024-01-01',
          endDate: '2024-01-31'
        },
        {}
      ])
    );

    const redisKeysRequests = getRequestsFor('GET', '/admin/redis/keys');
    expect(redisKeysRequests).toHaveLength(2);
    expect(redisKeysRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([{ cursor: '5', limit: '10' }, {}])
    );
  });
});
