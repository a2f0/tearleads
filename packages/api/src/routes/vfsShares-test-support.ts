import { type Mock, vi } from 'vitest';

export const mockQuery: Mock = vi.fn();
const mockGetPostgresPool: Mock = vi.fn();

vi.mock('../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
}));

const sessionStore = new Map<string, string>();
const mockRedisClient = {
  get: vi.fn((key: string) => Promise.resolve(sessionStore.get(key) ?? null)),
  set: vi.fn((key: string, value: string) => {
    sessionStore.set(key, value);
    return Promise.resolve('OK');
  }),
  del: vi.fn((key: string) => {
    sessionStore.delete(key);
    return Promise.resolve(1);
  }),
  sAdd: vi.fn(() => Promise.resolve(1)),
  sRem: vi.fn(() => Promise.resolve(1)),
  expire: vi.fn(() => Promise.resolve(1))
};

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => Promise.resolve(mockRedisClient)
}));

export function setupVfsSharesTestEnv(): void {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockGetPostgresPool.mockReset();
  sessionStore.clear();
  vi.stubEnv('JWT_SECRET', 'test-secret');
  mockGetPostgresPool.mockResolvedValue({
    query: mockQuery
  });
}

export function teardownVfsSharesTestEnv(): void {
  vi.unstubAllEnvs();
}
