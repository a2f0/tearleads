import { describe, expect, it, vi } from 'vitest';
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
    const handler = vi.fn();

    await client.subscribe('test-channel', handler);

    const delivered = await client.publish('test-channel', 'hello');

    expect(delivered).toBe(1);
    expect(handler).toHaveBeenCalledWith('hello', 'test-channel');

    await client.unsubscribe('test-channel');
    expect(await client.publish('test-channel', 'again')).toBe(0);
  });

  it('returns a separate client for duplicate', async () => {
    const client = createClient();
    const duplicate = client.duplicate();

    expect(duplicate).not.toBe(client);
    await duplicate.connect();
    await duplicate.quit();
  });

  it('invokes error handlers registered via on', () => {
    const client = createClient();
    const handler = vi.fn();
    const error = new Error('boom');

    client.on('error', handler);
    client.emitError(error);

    expect(handler).toHaveBeenCalledWith(error);
  });
});
