import { getRecordedApiRequests, wasApiRequestMade } from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogApiEvent = vi.fn();

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

describe('api with msw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    localStorage.clear();
    mockLogApiEvent.mockResolvedValue(undefined);
    const { setApiEventLogger } = await import('./apiLogger');
    setApiEventLogger(
      (...args: Parameters<typeof mockLogApiEvent>) => mockLogApiEvent(...args)
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    const { resetApiEventLogger } = await import('./apiLogger');
    resetApiEventLogger();
  });

  it('routes vfs and ai requests through msw', async () => {
    const api = await loadApi();

    await api.vfs.getMyKeys();
    await api.vfs.setupKeys({
      publicEncryptionKey: 'public-encryption-key',
      encryptedPrivateKeys: 'encrypted-private-keys',
      argon2Salt: 'argon2-salt'
    });
    await api.vfs.register({
      id: 'item-1',
      objectType: 'file',
      encryptedSessionKey: 'encrypted-session-key'
    });
    await api.vfs.getShares('item 1');
    await api.vfs.createShare({
      itemId: 'item 1',
      shareType: 'user',
      targetId: 'user-2',
      permissionLevel: 'view'
    });
    await api.vfs.updateShare('share 1', { permissionLevel: 'edit' });
    await api.vfs.deleteShare('share 1');
    await api.vfs.createOrgShare({
      itemId: 'item 1',
      sourceOrgId: 'org-1',
      targetOrgId: 'org-2',
      permissionLevel: 'view'
    });
    await api.vfs.deleteOrgShare('org share 1');
    await api.vfs.searchShareTargets('test query', 'user');

    await api.ai.createConversation({
      encryptedTitle: 'encrypted-title',
      encryptedSessionKey: 'encrypted-session-key'
    });
    await api.ai.listConversations({ cursor: 'cursor-1', limit: 5 });
    await api.ai.getConversation('conversation 1');
    await api.ai.updateConversation('conversation 1', {
      encryptedTitle: 'encrypted-title-2'
    });
    await expect(
      api.ai.deleteConversation('conversation 1')
    ).resolves.toBeUndefined();
    await api.ai.addMessage('conversation 1', {
      role: 'user',
      encryptedContent: 'encrypted-content'
    });
    await api.ai.recordUsage({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      modelId: 'mistralai/mistral-7b-instruct',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15
    });
    await api.ai.getUsage({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: 'cursor-1',
      limit: 10
    });
    await api.ai.getUsageSummary({
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    });

    expect(wasApiRequestMade('GET', '/vfs/keys/me')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/keys')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/register')).toBe(true);
    expect(wasApiRequestMade('GET', '/vfs/items/item%201/shares')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/items/item%201/shares')).toBe(true);
    expect(wasApiRequestMade('PATCH', '/vfs/shares/share%201')).toBe(true);
    expect(wasApiRequestMade('DELETE', '/vfs/shares/share%201')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/items/item%201/org-shares')).toBe(
      true
    );
    expect(wasApiRequestMade('DELETE', '/vfs/org-shares/org%20share%201')).toBe(
      true
    );
    expect(wasApiRequestMade('GET', '/vfs/share-targets/search')).toBe(true);

    expect(wasApiRequestMade('POST', '/ai/conversations')).toBe(true);
    expect(wasApiRequestMade('GET', '/ai/conversations')).toBe(true);
    expect(wasApiRequestMade('GET', '/ai/conversations/conversation%201')).toBe(
      true
    );
    expect(
      wasApiRequestMade('PATCH', '/ai/conversations/conversation%201')
    ).toBe(true);
    expect(
      wasApiRequestMade('DELETE', '/ai/conversations/conversation%201')
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/ai/conversations/conversation%201/messages')
    ).toBe(true);
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
      cursor: 'cursor-1',
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
    await api.admin.redis.getKeys('cursor-1', 10);
    await api.admin.redis.getKeys();

    await api.ai.listConversations({ cursor: 'cursor-1', limit: 5 });
    await api.ai.listConversations();
    await api.ai.getUsage({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: 'cursor-2',
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

    const aiConversationRequests = getRequestsFor('GET', '/ai/conversations');
    expect(aiConversationRequests).toHaveLength(2);
    expect(aiConversationRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([{ cursor: 'cursor-1', limit: '5' }, {}])
    );

    const aiUsageRequests = getRequestsFor('GET', '/ai/usage');
    expect(aiUsageRequests).toHaveLength(2);
    expect(aiUsageRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([
        {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
          cursor: 'cursor-2',
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
      expect.arrayContaining([{ cursor: 'cursor-1', limit: '10' }, {}])
    );
  });
});
