import { describe, expect, it } from 'vitest';
import { closeRedisClient, getRedisClient } from './redis.js';

describe('Redis Client re-exports', () => {
  it('exports getRedisClient from @tearleads/shared', () => {
    expect(getRedisClient).toBeDefined();
    expect(typeof getRedisClient).toBe('function');
  });

  it('exports closeRedisClient from @tearleads/shared', () => {
    expect(closeRedisClient).toBeDefined();
    expect(typeof closeRedisClient).toBe('function');
  });
});
