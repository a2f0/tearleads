import { type SeededUser, seedTestUser } from '@tearleads/api-test-utils';
import {
  getRecordedApiRequests,
  HttpResponse,
  http,
  server,
  wasApiRequestMade
} from '@tearleads/msw/node';
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
const AI_CONNECT_USAGE_PATH = '/connect/tearleads.v1.AiService/GetUsage';
const AI_CONNECT_USAGE_SUMMARY_PATH =
  '/connect/tearleads.v1.AiService/GetUsageSummary';
const CONNECT_BASE_URL = 'http://localhost';
const DEFAULT_USAGE_SUMMARY = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  requestCount: 0,
  periodStart: '2024-01-01T00:00:00.000Z',
  periodEnd: '2024-01-01T00:00:00.000Z'
};

const toConnectUrl = (path: string): string => `${CONNECT_BASE_URL}${path}`;

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
    let recordUsageRequestBody: unknown;
    let getUsageRequestBody: unknown;
    let getUsageSummaryRequestBody: unknown;

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

    server.use(
      http.post(
        toConnectUrl(AI_CONNECT_RECORD_USAGE_PATH),
        async ({ request }) => {
          recordUsageRequestBody = await request.json();
          return HttpResponse.json({
            usage: {
              id: 'usage-1',
              userId: seededUser.userId,
              modelId: 'mistralai/mistral-7b-instruct',
              promptTokens: 10,
              completionTokens: 5,
              totalTokens: 15,
              createdAt: '2024-01-01T00:00:00.000Z'
            }
          });
        }
      ),
      http.post(toConnectUrl(AI_CONNECT_USAGE_PATH), async ({ request }) => {
        getUsageRequestBody = await request.json();
        return HttpResponse.json({
          usage: [],
          summary: DEFAULT_USAGE_SUMMARY,
          hasMore: false
        });
      }),
      http.post(
        toConnectUrl(AI_CONNECT_USAGE_SUMMARY_PATH),
        async ({ request }) => {
          getUsageSummaryRequestBody = await request.json();
          return HttpResponse.json({
            summary: DEFAULT_USAGE_SUMMARY,
            byModel: {}
          });
        }
      )
    );

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
        '/connect/tearleads.v1.VfsSharesService/GetItemShares'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.VfsSharesService/CreateShare'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.VfsSharesService/UpdateShare'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.VfsSharesService/DeleteShare'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.VfsSharesService/CreateOrgShare'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.VfsSharesService/DeleteOrgShare'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.VfsService/RekeyItem')
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.VfsSharesService/SearchShareTargets'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.VfsSharesService/GetSharePolicyPreview'
      )
    ).toBe(true);

    expect(wasApiRequestMade('POST', AI_CONNECT_RECORD_USAGE_PATH)).toBe(true);
    expect(wasApiRequestMade('POST', AI_CONNECT_USAGE_PATH)).toBe(true);
    expect(wasApiRequestMade('POST', AI_CONNECT_USAGE_SUMMARY_PATH)).toBe(true);
    expect(recordUsageRequestBody).toEqual({
      modelId: 'mistralai/mistral-7b-instruct',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15
    });
    expect(getUsageRequestBody).toEqual({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: '2025-01-01T00:00:00.000Z',
      limit: 10
    });
    expect(getUsageSummaryRequestBody).toEqual({
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    });

    const previewRequests = getRequestsFor(
      'POST',
      '/connect/tearleads.v1.VfsSharesService/GetSharePolicyPreview'
    );
    expect(previewRequests).toHaveLength(2);
  });

  it('builds query-string variants through msw request metadata', async () => {
    const api = await loadApi();
    const getUsageRequestBodies: unknown[] = [];
    const getUsageSummaryRequestBodies: unknown[] = [];

    server.use(
      http.post(toConnectUrl(AI_CONNECT_USAGE_PATH), async ({ request }) => {
        getUsageRequestBodies.push(await request.json());
        return HttpResponse.json({
          usage: [],
          summary: DEFAULT_USAGE_SUMMARY,
          hasMore: false
        });
      }),
      http.post(
        toConnectUrl(AI_CONNECT_USAGE_SUMMARY_PATH),
        async ({ request }) => {
          getUsageSummaryRequestBodies.push(await request.json());
          return HttpResponse.json({
            summary: DEFAULT_USAGE_SUMMARY,
            byModel: {}
          });
        }
      )
    );

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
      'POST',
      '/connect/tearleads.v2.AdminService/GetRows'
    );
    expect(postgresRowsRequests).toHaveLength(4);

    const aiUsageRequests = getRequestsFor('POST', AI_CONNECT_USAGE_PATH);
    expect(aiUsageRequests).toHaveLength(2);

    const aiUsageSummaryRequests = getRequestsFor(
      'POST',
      AI_CONNECT_USAGE_SUMMARY_PATH
    );
    expect(aiUsageSummaryRequests).toHaveLength(2);
    expect(getUsageRequestBodies).toEqual([
      {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        cursor: '2025-01-01T00:00:00.000Z',
        limit: 25
      },
      {}
    ]);
    expect(getUsageSummaryRequestBodies).toEqual([
      {
        startDate: '2024-01-01',
        endDate: '2024-01-31'
      },
      {}
    ]);

    const redisKeysRequests = getRequestsFor(
      'POST',
      '/connect/tearleads.v2.AdminService/GetRedisKeys'
    );
    expect(redisKeysRequests.length).toBeGreaterThanOrEqual(2);
  });
});
