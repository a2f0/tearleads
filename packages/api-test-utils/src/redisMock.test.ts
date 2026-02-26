import { beforeEach, describe, expect, it } from 'vitest';
import { createRedisMock, type RedisMockClient } from './redisMock.js';

describe('RedisMock', () => {
  let redis: RedisMockClient;

  beforeEach(() => {
    redis = createRedisMock();
  });

  it('should set and get string values', async () => {
    await redis.set('key1', 'value1');
    expect(await redis.get('key1')).toBe('value1');
  });

  it('should return null for missing keys', async () => {
    expect(await redis.get('nonexistent')).toBeNull();
  });

  it('should delete keys', async () => {
    await redis.set('key1', 'value1');
    expect(await redis.del('key1')).toBe(1);
    expect(await redis.get('key1')).toBeNull();
    expect(await redis.del('key1')).toBe(0);
  });

  it('should support set operations', async () => {
    await redis.sAdd('myset', 'a');
    await redis.sAdd('myset', ['b', 'c']);
    const members = await redis.sMembers('myset');
    expect(members.sort()).toEqual(['a', 'b', 'c']);

    await redis.sRem('myset', 'b');
    const updated = await redis.sMembers('myset');
    expect(updated.sort()).toEqual(['a', 'c']);
  });

  it('should support hash operations', async () => {
    await redis.hSet('myhash', { field1: 'val1', field2: 'val2' });
    const all = await redis.hGetAll('myhash');
    expect(all).toEqual({ field1: 'val1', field2: 'val2' });
  });

  it('should support list operations', async () => {
    await redis.rPush('mylist', ['a', 'b', 'c']);
    expect(await redis.type('mylist')).toBe('list');
  });

  it('should report correct types', async () => {
    expect(await redis.type('missing')).toBe('none');
    await redis.set('str', 'val');
    expect(await redis.type('str')).toBe('string');
    await redis.sAdd('setkey', 'val');
    expect(await redis.type('setkey')).toBe('set');
    await redis.hSet('hashkey', { f: 'v' });
    expect(await redis.type('hashkey')).toBe('hash');
  });

  it('should support TTL', async () => {
    await redis.set('ttlkey', 'val', { EX: 300 });
    expect(await redis.ttl('ttlkey')).toBe(300);
    expect(await redis.ttl('nokey')).toBe(-1);
  });

  it('should support expire', async () => {
    await redis.set('ekey', 'val');
    expect(await redis.expire('ekey', 60)).toBe(1);
    expect(await redis.ttl('ekey')).toBe(60);
    expect(await redis.expire('missing', 60)).toBe(0);
  });

  it('should support mGet', async () => {
    await redis.set('a', '1');
    await redis.set('b', '2');
    const result = await redis.mGet(['a', 'b', 'c']);
    expect(result).toEqual(['1', '2', null]);
  });

  it('should support flushAll', async () => {
    await redis.set('k1', 'v1');
    await redis.set('k2', 'v2');
    expect(await redis.dbSize()).toBe(2);
    await redis.flushAll();
    expect(await redis.dbSize()).toBe(0);
  });

  it('should support multi with sMembers and get', async () => {
    await redis.set('session:1', 'data1');
    await redis.sAdd('user_sessions:u1', '1');

    const multi = redis.multi();
    const results = await multi
      .sMembers('user_sessions:u1')
      .get('session:1')
      .exec();

    expect(results).toEqual([['1'], 'data1']);
  });

  it('should support scan with pattern matching', async () => {
    await redis.set('user:1', 'a');
    await redis.set('user:2', 'b');
    await redis.set('session:1', 'c');

    const result = await redis.scan(0, { MATCH: 'user:*' });
    expect(result.keys.sort()).toEqual(['user:1', 'user:2']);
  });

  it('should support pub/sub', async () => {
    const messages: string[] = [];
    await redis.subscribe('chan1', (msg) => messages.push(msg));
    await redis.publish('chan1', 'hello');
    expect(messages).toEqual(['hello']);
    await redis.unsubscribe('chan1');
    await redis.publish('chan1', 'nope');
    expect(messages).toEqual(['hello']);
  });

  it('should support duplicate', async () => {
    await redis.set('k', 'v');
    const dup = redis.duplicate();
    expect(await dup.get('k')).toBe('v');
  });

  it('should support connect and quit without error', async () => {
    await redis.connect();
    await redis.quit();
  });

  it('should support dbSize', async () => {
    expect(await redis.dbSize()).toBe(0);
    await redis.set('a', '1');
    expect(await redis.dbSize()).toBe(1);
  });

  it('should support error handlers via on/emitError', () => {
    const errors: Error[] = [];
    redis.on('error', (err) => errors.push(err));
    redis.emitError(new Error('test error'));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('test error');
  });

  it('should support multi with type, ttl, del, set, sAdd, sRem, expire', async () => {
    await redis.set('mk', 'val', { EX: 120 });
    await redis.sAdd('ms', 'x');

    const results = await redis
      .multi()
      .set('mk2', 'v2')
      .type('mk')
      .ttl('mk')
      .del('mk')
      .sAdd('ms', 'y')
      .sRem('ms', 'x')
      .expire('mk2', 30)
      .exec();

    expect(results).toEqual(['OK', 'string', 120, 1, 1, 1, 1]);
  });

  it('should return empty for sMembers on non-set key', async () => {
    await redis.set('str', 'val');
    expect(await redis.sMembers('str')).toEqual([]);
  });

  it('should return empty for hGetAll on non-hash key', async () => {
    await redis.set('str', 'val');
    expect(await redis.hGetAll('str')).toEqual({});
  });

  it('should return 0 for sRem on non-set key', async () => {
    await redis.set('str', 'val');
    expect(await redis.sRem('str', 'x')).toBe(0);
  });

  it('should return 0 for publish with no subscribers', async () => {
    expect(await redis.publish('nochan', 'msg')).toBe(0);
  });
});
