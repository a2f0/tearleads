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
    const secondHandler = vi.fn();

    await client.subscribe('test-channel', handler);
    await client.subscribe('test-channel', secondHandler);

    const delivered = await client.publish('test-channel', 'hello');

    expect(delivered).toBe(2);
    expect(handler).toHaveBeenCalledWith('hello', 'test-channel');
    expect(secondHandler).toHaveBeenCalledWith('hello', 'test-channel');

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

  it('ignores non-error event handlers', () => {
    const client = createClient();
    const handler = vi.fn();
    const error = new Error('boom');

    client.on('message', handler);
    client.emitError(error);

    expect(handler).not.toHaveBeenCalled();
  });

  it('tracks values by type and ttl', async () => {
    const client = createClient();

    await client.set('string:key', 'value');
    await client.sAdd('set:key', ['alpha', 'beta']);
    await client.sAdd('set:key', ['beta', 'gamma']);
    await client.hSet('hash:key', { field: 'value' });
    await client.hSet('hash:key', { field: 'value', next: 'entry' });
    await client.rPush('list:key', ['first', 'second']);
    await client.rPush('list:key', ['third']);

    expect(await client.type('string:key')).toBe('string');
    expect(await client.type('set:key')).toBe('set');
    expect(await client.type('hash:key')).toBe('hash');
    expect(await client.type('list:key')).toBe('list');

    expect(await client.get('string:key')).toBe('value');
    expect(await client.get('list:key')).toBeNull();
    expect(await client.sMembers('set:key')).toEqual(['alpha', 'beta', 'gamma']);
    expect(await client.sMembers('string:key')).toEqual([]);
    expect(await client.hGetAll('hash:key')).toEqual({
      field: 'value',
      next: 'entry'
    });
    expect(await client.hGetAll('string:key')).toEqual({});

    expect(await client.expire('string:key', 120)).toBe(1);
    expect(await client.expire('missing:key', 120)).toBe(0);
    expect(await client.ttl('string:key')).toBe(120);

    expect(await client.del('string:key')).toBe(1);
    expect(await client.del('string:key')).toBe(0);
  });

  it('supports scan patterns and pagination', async () => {
    const client = createClient();

    await client.set('alpha:1', 'a');
    await client.set('alpha:2', 'b');
    await client.set('beta:1', 'c');

    const first = await client.scan(0, { MATCH: 'alpha:*', COUNT: 1 });
    expect(first).toEqual({ cursor: 1, keys: ['alpha:1'] });

    const second = await client.scan(first.cursor, {
      MATCH: 'alpha:*',
      COUNT: 1
    });
    expect(second).toEqual({ cursor: 0, keys: ['alpha:2'] });

    const all = await client.scan(0);
    expect(all.keys).toEqual(['alpha:1', 'alpha:2', 'beta:1']);

    const star = await client.scan(0, { MATCH: '*' });
    expect(star.keys).toEqual(['alpha:1', 'alpha:2', 'beta:1']);

    const wildcard = await client.scan(0, { MATCH: 'beta:?' });
    expect(wildcard).toEqual({ cursor: 0, keys: ['beta:1'] });
  });
});
