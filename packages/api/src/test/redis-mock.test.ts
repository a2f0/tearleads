import { describe, expect, it } from 'vitest';
import { createClient } from './redis-mock.js';

describe('redis mock adapter', () => {
  it('returns empty results for new clients', async () => {
    const client = createClient();

    expect(await client.dbSize()).toBe(0);
    expect(await client.scan(0)).toEqual({ cursor: 0, keys: [] });
    expect(await client.type('missing')).toBe('none');
    expect(await client.ttl('missing')).toBe(-1);
    expect(await client.get('missing')).toBeNull();
    expect(await client.sMembers('missing')).toEqual([]);
    expect(await client.hGetAll('missing')).toEqual({});
  });

  it('supports multi command chaining', async () => {
    const client = createClient();

    const results = await client.multi().type('missing').ttl('missing').exec();

    expect(results).toEqual(['none', -1]);
  });

  it('supports pubsub subscription lifecycle', async () => {
    const client = createClient();
    const handler = (message: string, channel: string) => {
      void message;
      void channel;
    };

    await client.subscribe('test-channel', handler);
    await client.unsubscribe('test-channel');
  });

  it('returns a separate client for duplicate', async () => {
    const client = createClient();
    const duplicate = client.duplicate();

    expect(duplicate).not.toBe(client);
    await duplicate.connect();
    await duplicate.quit();
  });
});
