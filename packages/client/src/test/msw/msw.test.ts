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
    const authHeaders = { Authorization: `Bearer ${seededUser.accessToken}` };
    const ctx = getSharedTestContext();
    await ctx.redis.set('user:1', 'test-value');

    const keysResponse = await fetch('http://localhost/admin/redis/keys', {
      headers: authHeaders
    });
    const keysPayload = await keysResponse.json();

    expect(wasApiRequestMade('GET', '/admin/redis/keys')).toBe(true);
    expect(keysPayload).toHaveProperty('keys');
    expect(keysPayload).toHaveProperty('cursor');
    expect(Array.isArray(keysPayload.keys)).toBe(true);

    const keyResponse = await fetch(
      'http://localhost/admin/redis/keys/user%3A1',
      { headers: authHeaders }
    );
    const keyPayload = await keyResponse.json();

    expect(wasApiRequestMade('GET', '/admin/redis/keys/user%3A1')).toBe(true);
    expect(keyPayload).toHaveProperty('key', 'user:1');
    expect(keyPayload).toHaveProperty('value', 'test-value');
  });

  it('mocks admin postgres endpoints', async () => {
    const authHeaders = { Authorization: `Bearer ${seededUser.accessToken}` };

    const infoResponse = await fetch('http://localhost/admin/postgres/info', {
      headers: authHeaders
    });
    const infoPayload = await infoResponse.json();

    expect(wasApiRequestMade('GET', '/admin/postgres/info')).toBe(true);
    expect(infoPayload).toHaveProperty('status', 'ok');
    expect(infoPayload).toHaveProperty('info');
    expect(infoPayload).toHaveProperty('serverVersion');

    const tablesResponse = await fetch(
      'http://localhost/admin/postgres/tables',
      { headers: authHeaders }
    );
    const tablesPayload = await tablesResponse.json();

    expect(wasApiRequestMade('GET', '/admin/postgres/tables')).toBe(true);
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
