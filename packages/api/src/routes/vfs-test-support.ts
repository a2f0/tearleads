import { type Mock, vi } from 'vitest';

export const mockQuery: Mock = vi.fn();
const mockGetPostgresPool: Mock = vi.fn();
export const mockClientRelease: Mock = vi.fn();
export const mockPoolConnect: Mock = vi.fn().mockImplementation(() =>
  Promise.resolve({
    query: mockQuery,
    release: mockClientRelease
  })
);

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

vi.mock('@tearleads/shared/redis', () => ({
  getRedisClient: () => Promise.resolve(mockRedisClient)
}));

export function setupVfsTestEnv(): void {
  vi.clearAllMocks();
  sessionStore.clear();
  vi.stubEnv('JWT_SECRET', 'test-secret');
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
  vi.unstubAllEnvs();
}
