import { seedTestUser } from '@tearleads/api-test-utils';
import { getRecordedApiRequests } from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_V2_CONNECT_USAGE_PATH,
  AI_V2_CONNECT_USAGE_SUMMARY_PATH
} from './test/aiConnectTestUtils';
import { installApiV2WasmBindingsOverride } from './test/apiV2WasmBindingsTestOverride';
import { getSharedTestContext } from './test/testContext';

const mockLogApiEvent = vi.fn();
const { seededState } = vi.hoisted(() => ({
  seededState: {
    userId: '',
    organizationId: ''
  }
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
      request.method === method.toUpperCase() &&
      request.pathname === pathname &&
      new URL(request.url).port.length === 0
  );

describe('api with msw vfs/ai query metadata', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    localStorage.clear();
    installApiV2WasmBindingsOverride();

    const ctx = getSharedTestContext();
    const seededUser = await seedTestUser(ctx, { admin: true });
    localStorage.setItem('auth_token', seededUser.accessToken);
    seededState.userId = seededUser.userId;
    seededState.organizationId = seededUser.organizationId;

    mockLogApiEvent.mockResolvedValue(undefined);
    const { setApiEventLogger } = await import('./apiLogger');
    setApiEventLogger((...args: Parameters<typeof mockLogApiEvent>) =>
      mockLogApiEvent(...args)
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    localStorage.removeItem('auth_token');
    const { resetApiEventLogger } = await import('./apiLogger');
    resetApiEventLogger();
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
      [seededState.userId, seededState.organizationId]
    );

    const api = await loadApi();

    await api.adminV2.postgres.getRows('public', 'users', {
      limit: 10,
      offset: 20,
      sortColumn: 'email',
      sortDirection: 'desc'
    });
    await api.adminV2.postgres.getRows('public', 'users');

    await api.adminV2.redis.getKeys('5', 10);
    await api.adminV2.redis.getKeys();

    const filteredUsage = await api.ai.getUsage({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: '2025-01-01T00:00:00.000Z',
      limit: 1
    });
    const allUsage = await api.ai.getUsage();

    const filteredSummary = await api.ai.getUsageSummary({
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    });
    const allSummary = await api.ai.getUsageSummary();

    expect(filteredUsage.usage).toHaveLength(1);
    expect(filteredUsage.hasMore).toBe(true);
    expect(filteredUsage.summary.totalTokens).toBe(30);
    expect(allUsage.summary.totalTokens).toBe(42);
    expect(filteredSummary.summary.totalTokens).toBe(30);
    expect(filteredSummary.byModel['openai/gpt-4o-mini']?.totalTokens).toBe(20);
    expect(allSummary.summary.totalTokens).toBe(42);

    const postgresRowsRequests = getRequestsFor(
      'POST',
      '/connect/tearleads.v2.AdminService/GetRows'
    );
    expect(postgresRowsRequests).toHaveLength(2);

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
    expect(redisKeysRequests).toHaveLength(2);
  });
});
