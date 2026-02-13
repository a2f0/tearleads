import { getRecordedApiRequests, wasApiRequestMade } from '@tearleads/msw/node';
import { DEFAULT_OPENROUTER_MODEL_ID } from '@tearleads/shared';
import { describe, expect, it } from 'vitest';

describe('msw handlers', () => {
  it('mocks the ping endpoint', async () => {
    const response = await fetch('http://localhost/ping');

    expect(response.ok).toBe(true);
    expect(wasApiRequestMade('GET', '/ping')).toBe(true);
    await expect(response.json()).resolves.toEqual({
      version: 'test',
      dbVersion: '0'
    });
  });

  it('mocks admin redis endpoints', async () => {
    const keysResponse = await fetch('http://localhost/admin/redis/keys');
    const keysPayload = await keysResponse.json();

    expect(wasApiRequestMade('GET', '/admin/redis/keys')).toBe(true);
    expect(keysPayload).toEqual({
      keys: [
        { key: 'key:1', type: 'string', ttl: -1 },
        { key: 'key:2', type: 'string', ttl: -1 },
        { key: 'key:3', type: 'string', ttl: -1 },
        { key: 'key:4', type: 'string', ttl: -1 },
        { key: 'key:5', type: 'string', ttl: -1 },
        { key: 'key:6', type: 'string', ttl: -1 },
        { key: 'key:7', type: 'string', ttl: -1 },
        { key: 'key:8', type: 'string', ttl: -1 },
        { key: 'key:9', type: 'string', ttl: -1 },
        { key: 'key:10', type: 'string', ttl: -1 }
      ],
      cursor: '10',
      hasMore: true
    });

    const keyResponse = await fetch(
      'http://localhost/admin/redis/keys/user%3A1'
    );
    const keyPayload = await keyResponse.json();

    expect(wasApiRequestMade('GET', '/admin/redis/keys/user%3A1')).toBe(true);
    expect(keyPayload).toEqual({
      key: 'user:1',
      type: 'string',
      ttl: -1,
      value: ''
    });
  });

  it('mocks admin postgres endpoints', async () => {
    const infoResponse = await fetch('http://localhost/admin/postgres/info');
    const infoPayload = await infoResponse.json();

    expect(wasApiRequestMade('GET', '/admin/postgres/info')).toBe(true);
    expect(infoPayload).toEqual({
      status: 'ok',
      info: {
        host: 'localhost',
        port: 5432,
        database: 'tearleads',
        user: 'tearleads'
      },
      serverVersion: 'PostgreSQL 15.1'
    });

    const tablesResponse = await fetch(
      'http://localhost/admin/postgres/tables'
    );
    const tablesPayload = await tablesResponse.json();

    expect(wasApiRequestMade('GET', '/admin/postgres/tables')).toBe(true);
    expect(tablesPayload).toEqual({
      tables: [
        {
          schema: 'public',
          name: 'users',
          rowCount: 12,
          totalBytes: 2048,
          tableBytes: 1024,
          indexBytes: 1024
        }
      ]
    });
  });

  it('mocks chat completions', async () => {
    const response = await fetch('http://localhost/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
    await fetch('http://localhost/ping');
    await fetch('http://localhost/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_OPENROUTER_MODEL_ID,
        messages: [{ role: 'user', content: 'Hello' }]
      })
    });

    const recordedRequests = getRecordedApiRequests();
    expect(recordedRequests).toEqual([
      {
        method: 'GET',
        pathname: '/ping',
        url: 'http://localhost/ping'
      },
      {
        method: 'POST',
        pathname: '/chat/completions',
        url: 'http://localhost/chat/completions'
      }
    ]);
  });
});
