import { type Mock, vi } from 'vitest';

export const mockQuery: Mock = vi.fn();
const mockGetPostgresPool: Mock = vi.fn();
export const mockClientRelease: Mock = vi.fn();
const mockPoolConnect: Mock = vi.fn().mockImplementation(() =>
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

export function setupCrdtPushRouteTestEnv(): void {
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
    connect: mockPoolConnect
  });
}

export function teardownCrdtPushRouteTestEnv(): void {
  vi.unstubAllEnvs();
}

export function buildValidPushPayload() {
  return {
    clientId: 'desktop',
    operations: [
      {
        opId: 'desktop-1',
        opType: 'acl_add',
        itemId: 'item-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T20:00:00.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      }
    ]
  };
}

export function buildLinkPushPayload(overrides?: Record<string, unknown>) {
  return {
    clientId: 'desktop',
    operations: [
      {
        opId: 'desktop-link-1',
        opType: 'link_add',
        itemId: 'item-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T20:00:00.000Z',
        parentId: 'parent-1',
        ...overrides
      }
    ]
  };
}
