import { type SeededUser, seedTestUser } from '@tearleads/api-test-utils';
import { getRecordedApiRequests, wasApiRequestMade } from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installApiV2WasmBindingsTestOverride,
  removeApiV2WasmBindingsTestOverride
} from '@/test/apiV2WasmBindingsTestOverride';
import { getSharedTestContext } from '@/test/testContext';

// Mock analytics to capture logged event names
const mockLogApiEvent = vi.fn();
vi.mock('@/db/analytics', () => ({
  logApiEvent: (...args: unknown[]) => mockLogApiEvent(...args)
}));

const { authState } = vi.hoisted(() => ({
  authState: { token: '' }
}));

vi.mock('@tearleads/api-client/authStorage', async () => {
  const actual = await vi.importActual<
    typeof import('@tearleads/api-client/authStorage')
  >('@tearleads/api-client/authStorage');
  return {
    ...actual,
    getAuthHeaderValue: () =>
      authState.token.length > 0 ? `Bearer ${authState.token}` : null
  };
});

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

const AI_CONNECT_RECORD_USAGE_PATH =
  '/connect/tearleads.v1.AiService/RecordUsage';
const AI_V2_CONNECT_USAGE_PATH = '/connect/tearleads.v2.AiService/GetUsage';
const AI_V2_CONNECT_USAGE_SUMMARY_PATH =
  '/connect/tearleads.v2.AiService/GetUsageSummary';

let seededUser: SeededUser;

describe('api with msw', () => {
  beforeEach(async () => {
    vi.resetModules();
    installApiV2WasmBindingsTestOverride();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    localStorage.clear();
    const ctx = getSharedTestContext();
    seededUser = await seedTestUser(ctx, { admin: true });
    authState.token = seededUser.accessToken;
    const { setActiveOrganizationId } = await import('@/lib/orgStorage');
    setActiveOrganizationId(seededUser.organizationId);
    mockLogApiEvent.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    removeApiV2WasmBindingsTestOverride();
    const { clearActiveOrganizationId } = await import('@/lib/orgStorage');
    clearActiveOrganizationId();
    authState.token = '';
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
      objectType: 'folder',
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
    await api.vfs.getSharePolicyPreview({
      rootItemId: 'item-1',
      principalType: 'user',
      principalId: secondUser.userId,
      limit: 25,
      maxDepth: 2,
      q: 'wallet',
      objectType: ['contact', 'walletItem']
    });

    // Negative preview path: non-container roots should be rejected
    await api.vfs.register({
      id: 'item-2',
      objectType: 'file',
      encryptedSessionKey: 'encrypted-session-key'
    });
    await expect(
      api.vfs.getSharePolicyPreview({
        rootItemId: 'item-2',
        principalType: 'user',
        principalId: secondUser.userId
      })
    ).rejects.toThrow('Root item must be a container object type');

    await ctx.pool.query(
      `INSERT INTO ai_usage (
         id,
         conversation_id,
         message_id,
         user_id,
         organization_id,
         model_id,
         prompt_tokens,
         completion_tokens,
         total_tokens,
         openrouter_request_id,
         created_at
       ) VALUES
         ('usage-jan-1', NULL, NULL, $1, $2, 'mistralai/mistral-7b-instruct', 10, 5, 15, 'req-jan-1', '2024-01-10T00:00:00.000Z'),
         ('usage-jan-2', NULL, NULL, $1, $2, 'openai/gpt-4o-mini', 7, 3, 10, 'req-jan-2', '2024-01-08T00:00:00.000Z')`,
      [seededUser.userId, seededUser.organizationId]
    );

    // AI usage (no FK-violating conversationId/messageId)
    const recordResponse = await api.ai.recordUsage({
      modelId: 'mistralai/mistral-7b-instruct',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15
    });
    const usageResponse = await api.ai.getUsage({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: '2025-01-01T00:00:00.000Z',
      limit: 1
    });
    const summaryResponse = await api.ai.getUsageSummary({
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    });

    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.VfsService/SetupKeys')
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.VfsService/GetMyKeys')
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.VfsService/Register')
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.VfsSharesService/GetItemShares'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.VfsSharesService/CreateShare'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.VfsSharesService/UpdateShare'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.VfsSharesService/DeleteShare'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.VfsSharesService/CreateOrgShare'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.VfsSharesService/DeleteOrgShare'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.VfsService/RekeyItem')
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.VfsSharesService/SearchShareTargets'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.VfsSharesService/GetSharePolicyPreview'
      )
    ).toBe(true);

    expect(wasApiRequestMade('POST', AI_CONNECT_RECORD_USAGE_PATH)).toBe(true);
    expect(wasApiRequestMade('POST', AI_V2_CONNECT_USAGE_PATH)).toBe(true);
    expect(wasApiRequestMade('POST', AI_V2_CONNECT_USAGE_SUMMARY_PATH)).toBe(
      true
    );
    expect(recordResponse.usage.userId).toBe(seededUser.userId);
    expect(usageResponse.usage).toHaveLength(1);
    expect(usageResponse.hasMore).toBe(true);
    expect(usageResponse.summary.totalTokens).toBe(25);
    expect(summaryResponse.summary.totalTokens).toBe(25);
    expect(
      summaryResponse.byModel['mistralai/mistral-7b-instruct']?.totalTokens
    ).toBe(15);

    const previewRequests = getRequestsFor(
      'POST',
      '/connect/tearleads.v2.VfsSharesService/GetSharePolicyPreview'
    );
    expect(previewRequests).toHaveLength(2);
  });

  it('builds query-string variants through msw request metadata', async () => {
    const ctx = getSharedTestContext();
    await ctx.pool.query(
      `INSERT INTO ai_usage (
         id,
         conversation_id,
         message_id,
         user_id,
         organization_id,
         model_id,
         prompt_tokens,
         completion_tokens,
         total_tokens,
         openrouter_request_id,
         created_at
       ) VALUES
         ('usage-1', NULL, NULL, $1, $2, 'openai/gpt-4o-mini', 12, 8, 20, 'req-1', '2024-01-10T00:00:00.000Z'),
         ('usage-2', NULL, NULL, $1, $2, 'openai/gpt-4o', 6, 4, 10, 'req-2', '2024-01-05T00:00:00.000Z'),
         ('usage-3', NULL, NULL, $1, $2, 'openai/gpt-4.1', 7, 5, 12, 'req-3', '2024-02-10T00:00:00.000Z')`,
      [seededUser.userId, seededUser.organizationId]
    );

    const api = await loadApi();

    await api.adminV2.postgres.getRows('public', 'users', {
      limit: 10,
      offset: 20,
      sortColumn: 'email',
      sortDirection: 'desc'
    });
    await api.adminV2.postgres.getRows('public', 'users');

    // Redis getKeys: with params vs without
    await api.adminV2.redis.getKeys('5', 10);
    await api.adminV2.redis.getKeys();

    const filteredUsage = await api.ai.getUsage({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: '2025-01-01T00:00:00.000Z',
      limit: 25
    });
    const allUsage = await api.ai.getUsage();
    const filteredSummary = await api.ai.getUsageSummary({
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    });
    const allSummary = await api.ai.getUsageSummary();

    expect(filteredUsage.summary.totalTokens).toBe(30);
    expect(allUsage.summary.totalTokens).toBe(42);
    expect(filteredSummary.summary.totalTokens).toBe(30);
    expect(filteredSummary.byModel['openai/gpt-4o-mini']?.totalTokens).toBe(20);
    expect(allSummary.summary.totalTokens).toBe(42);

    const postgresRowsRequests = getRequestsFor(
      'POST',
      '/connect/tearleads.v2.AdminService/GetRows'
    );
    expect(postgresRowsRequests).toHaveLength(4);

    const aiUsageRequests = getRequestsFor('POST', AI_V2_CONNECT_USAGE_PATH);
    expect(aiUsageRequests).toHaveLength(2);

    const aiUsageSummaryRequests = getRequestsFor(
      'POST',
      AI_V2_CONNECT_USAGE_SUMMARY_PATH
    );
    expect(aiUsageSummaryRequests).toHaveLength(2);

    const redisKeysRequests = getRequestsFor(
      'POST',
      '/connect/tearleads.v2.AdminService/GetRedisKeys'
    );
    expect(redisKeysRequests.length).toBeGreaterThanOrEqual(2);
  });
});
