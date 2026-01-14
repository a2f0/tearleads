import { describe, expect, it } from 'vitest';

describe('msw handlers', () => {
  it('mocks the ping endpoint', async () => {
    const response = await fetch('http://localhost/ping');

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({ version: 'test' });
  });

  it('mocks admin redis endpoints', async () => {
    const keysResponse = await fetch('http://localhost/admin/redis/keys');
    const keysPayload = await keysResponse.json();

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

    expect(keyPayload).toEqual({
      key: 'user:1',
      type: 'string',
      ttl: -1,
      value: ''
    });
  });
});
