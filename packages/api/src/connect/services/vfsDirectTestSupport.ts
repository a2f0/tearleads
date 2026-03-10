import { type Mock, vi } from 'vitest';
import { resetTestEnv, setTestEnv } from '../../test/env.js';

export const mockQuery: Mock = vi.fn();
const mockGetPostgresPool: Mock = vi.fn();
export const mockClientRelease: Mock = vi.fn();
export const mockPoolConnect: Mock = vi.fn().mockImplementation(() =>
  Promise.resolve({
    query: mockQuery,
    release: mockClientRelease
  })
);

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool()
}));

type RedisValue = string | Set<string>;
const sessionStore = new Map<string, RedisValue>();
export const mockRedisStore = sessionStore;
export const mockRedisClient = {
  get: vi.fn((key: string) => {
    const value = sessionStore.get(key);
    return Promise.resolve(typeof value === 'string' ? value : null);
  }),
  set: vi.fn((key: string, value: string, _options?: { EX?: number }) => {
    sessionStore.set(key, value);
    return Promise.resolve('OK');
  }),
  del: vi.fn((keyOrKeys: string | string[]) => {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    let deletedCount = 0;

    for (const key of keys) {
      if (sessionStore.delete(key)) {
        deletedCount += 1;
      }
    }

    return Promise.resolve(deletedCount);
  }),
  mGet: vi.fn((keys: string[]) => {
    const values = keys.map((key) => {
      const value = sessionStore.get(key);
      return typeof value === 'string' ? value : null;
    });
    return Promise.resolve(values);
  }),
  sAdd: vi.fn((key: string, members: string | string[]) => {
    const existing = sessionStore.get(key);
    const set = existing instanceof Set ? existing : new Set<string>();
    const sizeBefore = set.size;
    const values = Array.isArray(members) ? members : [members];
    for (const value of values) {
      set.add(value);
    }
    sessionStore.set(key, set);
    return Promise.resolve(set.size - sizeBefore);
  }),
  sRem: vi.fn((key: string, member: string) => {
    const existing = sessionStore.get(key);
    if (!(existing instanceof Set)) {
      return Promise.resolve(0);
    }
    const deleted = existing.delete(member);
    if (existing.size === 0) {
      sessionStore.delete(key);
    }
    return Promise.resolve(deleted ? 1 : 0);
  }),
  sMembers: vi.fn((key: string) => {
    const existing = sessionStore.get(key);
    if (!(existing instanceof Set)) {
      return Promise.resolve([]);
    }
    return Promise.resolve(Array.from(existing));
  }),
  expire: vi.fn((_key: string, _seconds: number) => Promise.resolve(1))
};

vi.mock('@tearleads/shared/redis', () => ({
  getRedisClient: () => Promise.resolve(mockRedisClient),
  getRedisSubscriberOverride: () => mockRedisClient,
  setRedisSubscriberOverrideForTesting: vi.fn()
}));

export function setupVfsTestEnv(): void {
  vi.clearAllMocks();
  sessionStore.clear();
  setTestEnv('JWT_SECRET', 'test-secret');
  mockPoolConnect.mockImplementation(() =>
    Promise.resolve({
      query: mockQuery,
      release: mockClientRelease
    })
  );
  mockGetPostgresPool.mockResolvedValue({
    query: mockQuery,
    connect: mockPoolConnect
  });
}

export function teardownVfsTestEnv(): void {
  resetTestEnv();
}
