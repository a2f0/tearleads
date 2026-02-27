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
      http.post('http://localhost/chat/completions', () =>
        HttpResponse.json({
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
    );

    const response = await fetch('http://localhost/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${seededUser.accessToken}`
      },
      body: JSON.stringify({
        model: DEFAULT_OPENROUTER_MODEL_ID,
        messages: [{ role: 'user', content: 'Hello' }]
      })
    });

    expect(response.ok).toBe(true);
    expect(wasApiRequestMade('POST', '/chat/completions')).toBe(true);
    await expect(response.json()).resolves.toEqual({
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
    const response = await fetch('http://localhost/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${seededUser.accessToken}`
      },
      body: JSON.stringify({ messages: [] })
    });

    expect(response.status).toBe(400);
    expect(wasApiRequestMade('POST', '/chat/completions')).toBe(true);
    await expect(response.json()).resolves.toEqual({
      error: 'messages must be a non-empty array'
    });
  });

  it('returns model validation errors for chat completions', async () => {
    const response = await fetch('http://localhost/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${seededUser.accessToken}`
      },
      body: JSON.stringify({
        model: 'unknown/model',
        messages: [{ role: 'user', content: 'Hello' }]
      })
    });

    expect(response.status).toBe(400);
    expect(wasApiRequestMade('POST', '/chat/completions')).toBe(true);
    await expect(response.json()).resolves.toEqual({
      error: 'model must be a supported OpenRouter chat model'
    });
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
