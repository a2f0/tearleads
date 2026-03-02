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

function connectChatPayload(payload: unknown): { json: string } {
  return {
    json: JSON.stringify(payload)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

beforeEach(async () => {
  vi.resetModules();
  const ctx = getSharedTestContext();
  seededUser = await seedTestUser(ctx, { admin: true });
});

describe('msw handlers', () => {
  it('mocks the ping endpoint', async () => {
    const response = await fetch('http://localhost/ping', {
      headers: { Authorization: `Bearer ${seededUser.accessToken}` }
    });

    expect(response.ok).toBe(true);
    expect(wasApiRequestMade('GET', '/ping')).toBe(true);
    const payload = await response.json();
    expect(payload).toHaveProperty('version');
    expect(payload).toHaveProperty('dbVersion');
  });

  it('mocks admin redis endpoints', async () => {
    const authHeaders = {
      Authorization: `Bearer ${seededUser.accessToken}`,
      'Content-Type': 'application/json'
    };
    const ctx = getSharedTestContext();
    await ctx.redis.set('user:1', 'test-value');

    const keysResponse = await fetch(
      'http://localhost/connect/tearleads.v1.AdminService/GetRedisKeys',
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ cursor: '', limit: 100 })
      }
    );
    const keysWirePayload = await keysResponse.json();
    if (
      !isRecord(keysWirePayload) ||
      typeof keysWirePayload['json'] !== 'string'
    ) {
      throw new Error('Expected connect JSON payload');
    }
    const keysPayload = JSON.parse(keysWirePayload['json']);

    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/GetRedisKeys'
      )
    ).toBe(true);
    expect(keysPayload).toHaveProperty('keys');
    expect(keysPayload).toHaveProperty('cursor');
    expect(Array.isArray(keysPayload.keys)).toBe(true);

    const keyResponse = await fetch(
      'http://localhost/connect/tearleads.v1.AdminService/GetRedisValue',
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ key: 'user:1' })
      }
    );
    const keyWirePayload = await keyResponse.json();
    if (
      !isRecord(keyWirePayload) ||
      typeof keyWirePayload['json'] !== 'string'
    ) {
      throw new Error('Expected connect JSON payload');
    }
    const keyPayload = JSON.parse(keyWirePayload['json']);

    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/GetRedisValue'
      )
    ).toBe(true);
    expect(keyPayload).toHaveProperty('key', 'user:1');
    expect(keyPayload).toHaveProperty('value', 'test-value');
  });

  it('mocks admin postgres endpoints', async () => {
    const authHeaders = {
      Authorization: `Bearer ${seededUser.accessToken}`,
      'Content-Type': 'application/json'
    };

    const infoResponse = await fetch(
      'http://localhost/connect/tearleads.v1.AdminService/GetPostgresInfo',
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({})
      }
    );
    const infoWirePayload = await infoResponse.json();
    if (
      !isRecord(infoWirePayload) ||
      typeof infoWirePayload['json'] !== 'string'
    ) {
      throw new Error('Expected connect JSON payload');
    }
    const infoPayload = JSON.parse(infoWirePayload['json']);

    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/GetPostgresInfo'
      )
    ).toBe(true);
    expect(infoPayload).toHaveProperty('status', 'ok');
    expect(infoPayload).toHaveProperty('info');
    expect(infoPayload).toHaveProperty('serverVersion');

    const tablesResponse = await fetch(
      'http://localhost/connect/tearleads.v1.AdminService/GetTables',
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({})
      }
    );
    const tablesWirePayload = await tablesResponse.json();
    if (
      !isRecord(tablesWirePayload) ||
      typeof tablesWirePayload['json'] !== 'string'
    ) {
      throw new Error('Expected connect JSON payload');
    }
    const tablesPayload = JSON.parse(tablesWirePayload['json']);

    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v1.AdminService/GetTables')
    ).toBe(true);
    expect(tablesPayload).toHaveProperty('tables');
    expect(Array.isArray(tablesPayload.tables)).toBe(true);
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

    await fetch('http://localhost/ping', { headers: authHeaders });
    await fetch('http://localhost/admin/redis/dbsize', {
      headers: authHeaders
    });

    // Filter out internal bypass requests (forwarded to Express on a random port)
    const recordedRequests = getRecordedApiRequests().filter((r) =>
      r.url.startsWith('http://localhost/')
    );
    expect(recordedRequests).toEqual([
      {
        method: 'GET',
        pathname: '/ping',
        url: 'http://localhost/ping'
      },
      {
        method: 'GET',
        pathname: '/admin/redis/dbsize',
        url: 'http://localhost/admin/redis/dbsize'
      }
    ]);
  });
});
