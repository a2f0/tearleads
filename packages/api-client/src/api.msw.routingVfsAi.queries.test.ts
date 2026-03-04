import { seedTestUser } from '@tearleads/api-test-utils';
import { getRecordedApiRequests } from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_CONNECT_USAGE_PATH,
  AI_CONNECT_USAGE_SUMMARY_PATH,
  installAiUsageConnectSeriesCapture
} from './test/aiConnectTestUtils';
import { installApiV2WasmBindingsOverride } from './test/apiV2WasmBindingsTestOverride';
import { getSharedTestContext } from './test/testContext';

const mockLogApiEvent = vi.fn();
const { authState } = vi.hoisted(() => ({
  authState: { token: '' }
}));

vi.mock('./authStorage', async () => {
  const actual =
    await vi.importActual<typeof import('./authStorage')>('./authStorage');
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
    authState.token = seededUser.accessToken;

    mockLogApiEvent.mockResolvedValue(undefined);
    const { setApiEventLogger } = await import('./apiLogger');
    setApiEventLogger((...args: Parameters<typeof mockLogApiEvent>) =>
      mockLogApiEvent(...args)
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    const { resetApiEventLogger } = await import('./apiLogger');
    resetApiEventLogger();
  });

  it('builds query-string variants through msw request metadata', async () => {
    const api = await loadApi();
    const capture = installAiUsageConnectSeriesCapture();

    await api.admin.postgres.getRows('public', 'users', {
      limit: 10,
      offset: 20,
      sortColumn: 'email',
      sortDirection: 'desc'
    });
    await api.admin.postgres.getRows('public', 'users');

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
      'POST',
      '/connect/tearleads.v2.AdminService/GetRows'
    );
    expect(postgresRowsRequests).toHaveLength(2);

    const aiUsageRequests = getRequestsFor('POST', AI_CONNECT_USAGE_PATH);
    expect(aiUsageRequests).toHaveLength(2);

    const aiUsageSummaryRequests = getRequestsFor(
      'POST',
      AI_CONNECT_USAGE_SUMMARY_PATH
    );
    expect(aiUsageSummaryRequests).toHaveLength(2);

    expect(capture.getUsageRequestBodies).toEqual([
      {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        cursor: '2025-01-01T00:00:00.000Z',
        limit: 25
      },
      {}
    ]);
    expect(capture.getUsageSummaryRequestBodies).toEqual([
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
    expect(redisKeysRequests).toHaveLength(2);
  });
});
