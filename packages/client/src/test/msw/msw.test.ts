import { type SeededUser, seedTestUser } from '@tearleads/api-test-utils';
import {
  getRecordedApiRequests,
  HttpResponse,
  http,
  server,
  wasApiRequestMade
} from '@tearleads/msw/node';
import { DEFAULT_OPENROUTER_MODEL_ID } from '@tearleads/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSharedTestContext } from '../testContext';

let seededUser: SeededUser;
const CHAT_COMPLETIONS_CONNECT_PATH =
  '/connect/tearleads.v1.ChatService/PostCompletions';
const CHAT_COMPLETIONS_CONNECT_URL = `http://localhost${CHAT_COMPLETIONS_CONNECT_PATH}`;
// Keep this test on Connect admin paths because API runtime now serves admin
// functionality via /v1/connect and no longer mounts legacy /admin/* routes.
const ADMIN_CONNECT_PATH_PREFIX = '/connect/tearleads.v1.AdminService';

function connectChatPayload(payload: unknown): { json: string } {
  return {
    json: JSON.stringify(payload)
  };
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if ('message' in payload && typeof payload.message === 'string') {
    return payload.message;
  }

  if ('error' in payload && typeof payload.error === 'string') {
    return payload.error;
  }

  return null;
}

function parseConnectJsonPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || !('json' in payload)) {
    throw new Error('Expected connect response payload with json field');
  }

  const jsonPayload = payload.json;
  if (typeof jsonPayload !== 'string') {
    throw new Error('Expected connect json field to be a string');
  }

  return JSON.parse(jsonPayload);
}

async function postAdminConnectRequest(
  method: string,
  accessToken: string,
  payload: unknown = {}
): Promise<unknown> {
  const response = await fetch(
    `http://localhost${ADMIN_CONNECT_PATH_PREFIX}/${method}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(payload)
    }
  );

  expect(response.ok).toBe(true);
  return parseConnectJsonPayload(await response.json());
}

beforeEach(async () => {
  vi.resetModules();
  const ctx = getSharedTestContext();
  seededUser = await seedTestUser(ctx, { admin: true });
});

describe('msw handlers', () => {
  it('mocks the ping endpoint', async () => {
    const response = await fetch('http://localhost/v2/ping', {
      headers: { Authorization: `Bearer ${seededUser.accessToken}` }
    });

    expect(response.ok).toBe(true);
    expect(wasApiRequestMade('GET', '/v2/ping')).toBe(true);
    const payload = await response.json();
    expect(payload).toHaveProperty('status', 'ok');
    expect(payload).toHaveProperty('service', 'api-v2');
    expect(payload).toHaveProperty('version');
  });

  it('mocks admin redis connect endpoints', async () => {
    const ctx = getSharedTestContext();
    await ctx.redis.set('user:1', 'test-value');

    const keysPayload = await postAdminConnectRequest(
      'GetRedisKeys',
      seededUser.accessToken,
      {
        cursor: '0',
        limit: 50
      }
    );

    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/GetRedisKeys'
      )
    ).toBe(true);
    expect(keysPayload).toHaveProperty('keys');
    expect(keysPayload).toHaveProperty('cursor');
    expect(
      Array.isArray(
        typeof keysPayload === 'object' && keysPayload && 'keys' in keysPayload
          ? keysPayload.keys
          : null
      )
    ).toBe(true);

    const keyPayload = await postAdminConnectRequest(
      'GetRedisValue',
      seededUser.accessToken,
      {
        key: 'user:1'
      }
    );

    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/GetRedisValue'
      )
    ).toBe(true);
    expect(keyPayload).toHaveProperty('key', 'user:1');
    expect(keyPayload).toHaveProperty('value', 'test-value');
  });

  it('returns not found for deprecated admin redis rest endpoints', async () => {
    const authHeaders = { Authorization: `Bearer ${seededUser.accessToken}` };
    const ctx = getSharedTestContext();
    await ctx.redis.set('user:1', 'test-value');

    const keysResponse = await fetch('http://localhost/admin/redis/keys', {
      headers: authHeaders
    });
    const keysPayload = await keysResponse.json();

    expect(wasApiRequestMade('GET', '/admin/redis/keys')).toBe(true);
    expect(keysResponse.status).toBe(404);
    expect(keysPayload).toEqual({ error: 'Not found' });

    const keyResponse = await fetch(
      'http://localhost/admin/redis/keys/user%3A1',
      { headers: authHeaders }
    );
    const keyPayload = await keyResponse.json();

    expect(wasApiRequestMade('GET', '/admin/redis/keys/user%3A1')).toBe(true);
    expect(keyResponse.status).toBe(404);
    expect(keyPayload).toEqual({ error: 'Not found' });
  });

  it('mocks admin postgres connect endpoints', async () => {
    const infoPayload = await postAdminConnectRequest(
      'GetPostgresInfo',
      seededUser.accessToken
    );
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/GetPostgresInfo'
      )
    ).toBe(true);
    expect(infoPayload).toHaveProperty('status', 'ok');
    expect(infoPayload).toHaveProperty('info');
    expect(infoPayload).toHaveProperty('serverVersion');

    const tablesPayload = await postAdminConnectRequest(
      'GetTables',
      seededUser.accessToken
    );

    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v1.AdminService/GetTables')
    ).toBe(true);
    expect(tablesPayload).toHaveProperty('tables');
    expect(
      Array.isArray(
        typeof tablesPayload === 'object' &&
          tablesPayload &&
          'tables' in tablesPayload
          ? tablesPayload.tables
          : null
      )
    ).toBe(true);
  });

  it('returns not found for deprecated admin postgres rest endpoints', async () => {
    const authHeaders = { Authorization: `Bearer ${seededUser.accessToken}` };

    const infoResponse = await fetch('http://localhost/admin/postgres/info', {
      headers: authHeaders
    });
    const infoPayload = await infoResponse.json();

    expect(wasApiRequestMade('GET', '/admin/postgres/info')).toBe(true);
    expect(infoResponse.status).toBe(404);
    expect(infoPayload).toEqual({ error: 'Not found' });

    const tablesResponse = await fetch(
      'http://localhost/admin/postgres/tables',
      { headers: authHeaders }
    );
    const tablesPayload = await tablesResponse.json();

    expect(wasApiRequestMade('GET', '/admin/postgres/tables')).toBe(true);
    expect(tablesResponse.status).toBe(404);
    expect(tablesPayload).toEqual({ error: 'Not found' });
  });

  it('mocks chat completions', async () => {
    // Chat completions proxy to OpenRouter (external), so use server.use() override
    server.use(
      http.post(CHAT_COMPLETIONS_CONNECT_URL, () =>
        HttpResponse.json(
          connectChatPayload({
            id: 'chatcmpl-test',
            model: DEFAULT_OPENROUTER_MODEL_ID,
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Mock reply'
                }
              }
            ]
          })
        )
      )
    );

    const response = await fetch(CHAT_COMPLETIONS_CONNECT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${seededUser.accessToken}`
      },
      body: JSON.stringify({
        json: JSON.stringify({
          model: DEFAULT_OPENROUTER_MODEL_ID,
          messages: [{ role: 'user', content: 'Hello' }]
        })
      })
    });

    expect(response.ok).toBe(true);
    expect(wasApiRequestMade('POST', CHAT_COMPLETIONS_CONNECT_PATH)).toBe(true);
    const wirePayload = await response.json();
    expect(wirePayload).toEqual(
      connectChatPayload({
        id: 'chatcmpl-test',
        model: DEFAULT_OPENROUTER_MODEL_ID,
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Mock reply'
            }
          }
        ]
      })
    );
    expect(typeof wirePayload.json).toBe('string');
    if (typeof wirePayload.json !== 'string') {
      throw new Error('Expected connect payload json string');
    }
    expect(JSON.parse(wirePayload.json)).toEqual({
      id: 'chatcmpl-test',
      model: DEFAULT_OPENROUTER_MODEL_ID,
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Mock reply'
          }
        }
      ]
    });
  });

  it('returns validation errors for chat completions', async () => {
    const response = await fetch(CHAT_COMPLETIONS_CONNECT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${seededUser.accessToken}`
      },
      body: JSON.stringify({
        json: JSON.stringify({ messages: [] })
      })
    });

    expect(response.status).toBe(400);
    expect(wasApiRequestMade('POST', CHAT_COMPLETIONS_CONNECT_PATH)).toBe(true);
    const payload = await response.json();
    expect(extractErrorMessage(payload)).toContain(
      'messages must be a non-empty array'
    );
  });

  it('returns model validation errors for chat completions', async () => {
    const response = await fetch(CHAT_COMPLETIONS_CONNECT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${seededUser.accessToken}`
      },
      body: JSON.stringify({
        json: JSON.stringify({
          model: 'unknown/model',
          messages: [{ role: 'user', content: 'Hello' }]
        })
      })
    });

    expect(response.status).toBe(400);
    expect(wasApiRequestMade('POST', CHAT_COMPLETIONS_CONNECT_PATH)).toBe(true);
    const payload = await response.json();
    expect(extractErrorMessage(payload)).toContain(
      'model must be a supported OpenRouter chat model'
    );
  });

  it('records request metadata for debugging parity', async () => {
    const authHeaders = { Authorization: `Bearer ${seededUser.accessToken}` };

    await fetch('http://localhost/v2/ping', { headers: authHeaders });
    await postAdminConnectRequest('GetRedisDbSize', seededUser.accessToken);

    // Filter out internal bypass requests (forwarded to Express on a random port)
    const recordedRequests = getRecordedApiRequests().filter((r) =>
      r.url.startsWith('http://localhost/')
    );
    expect(recordedRequests).toEqual([
      {
        method: 'GET',
        pathname: '/v2/ping',
        url: 'http://localhost/v2/ping'
      },
      {
        method: 'POST',
        pathname: '/connect/tearleads.v1.AdminService/GetRedisDbSize',
        url: 'http://localhost/connect/tearleads.v1.AdminService/GetRedisDbSize'
      }
    ]);
  });
});
