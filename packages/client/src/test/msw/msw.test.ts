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

    expect(keysPayload).toEqual({ keys: [], cursor: '0', hasMore: false });

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
