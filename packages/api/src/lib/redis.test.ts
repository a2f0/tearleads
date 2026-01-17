import { describe, expect, it } from 'vitest';
import { closeRedisClient, getRedisClient } from './redis.js';

describe('Redis Client re-exports', () => {
  it('exports getRedisClient from @rapid/shared', () => {
    expect(getRedisClient).toBeDefined();
    expect(typeof getRedisClient).toBe('function');
  });

  it('exports closeRedisClient from @rapid/shared', () => {
    expect(closeRedisClient).toBeDefined();
    expect(typeof closeRedisClient).toBe('function');
  });
});
