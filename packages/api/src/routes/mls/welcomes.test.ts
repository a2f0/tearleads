import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const sessionStore = new Map<string, string>();
const userSessionsStore = new Map<string, Set<string>>();
const mockTtl = new Map<string, number>();

const createMockClient = () => ({
  get: (key: string) => {
    if (key.startsWith('session:')) {
      return Promise.resolve(sessionStore.get(key) ?? null);
    }
    return Promise.resolve(null);
  },
  set: (key: string, value: string, options?: { EX?: number }) => {
    sessionStore.set(key, value);
    if (options?.EX) {
      mockTtl.set(key, options.EX);
    }
    return Promise.resolve('OK');
  },
  expire: (key: string, seconds: number) => {
    mockTtl.set(key, seconds);
    return Promise.resolve(1);
  },
  ttl: (key: string) => Promise.resolve(mockTtl.get(key) ?? -1),
  sAdd: (key: string, member: string) => {
    if (!userSessionsStore.has(key)) {
      userSessionsStore.set(key, new Set());
    }
    userSessionsStore.get(key)?.add(member);
    return Promise.resolve(1);
  },
  sRem: (key: string, member: string) => {
    const set = userSessionsStore.get(key);
    if (set?.delete(member)) {
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
  },
  sMembers: (key: string) => {
    const set = userSessionsStore.get(key);
    return Promise.resolve(set ? Array.from(set) : []);
  }
});

vi.mock('../../lib/redis.js', () => ({
  getRedisClient: vi.fn(() => Promise.resolve(createMockClient()))
}));

interface MockWelcome {
  id: string;
  userId: string;
  groupId: string;
  welcomeData: string;
  acknowledged: boolean;
  createdAt: Date;
}

interface MockGroup {
  id: string;
  name: string;
  mlsGroupId: string;
  createdBy: string;
  createdAt: Date;
}

const mockWelcomes: MockWelcome[] = [];
const mockGroups: MockGroup[] = [];

vi.mock('../../lib/db.js', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(mockWelcomes)),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(mockWelcomes))
        })),
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(mockWelcomes))
        }))
      }))
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([{ id: 'welcome-1' }]))
      }))
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([]))
    }))
  }))
}));

describe('MLS Welcomes Routes', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    sessionStore.clear();
    userSessionsStore.clear();
    mockTtl.clear();
    mockWelcomes.length = 0;
    mockGroups.length = 0;
    authHeader = await createAuthHeader();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('GET /v1/mls/welcomes', () => {
    it('returns pending welcome messages', async () => {
      mockWelcomes.push({
        id: 'welcome-1',
        userId: 'user-1',
        groupId: 'group-1',
        welcomeData: 'welcome-data-base64',
        acknowledged: false,
        createdAt: new Date()
      });

      mockGroups.push({
        id: 'group-1',
        name: 'Test Group',
        mlsGroupId: 'mls-1',
        createdBy: 'user-2',
        createdAt: new Date()
      });

      const response = await request(app)
        .get('/v1/mls/welcomes')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('welcomes');
      expect(Array.isArray(response.body.welcomes)).toBe(true);
    });

    it('returns empty array when no welcomes', async () => {
      const response = await request(app)
        .get('/v1/mls/welcomes')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.welcomes).toEqual([]);
    });
  });

  describe('POST /v1/mls/welcomes/:welcomeId/ack', () => {
    it('acknowledges a welcome message', async () => {
      mockWelcomes.push({
        id: 'welcome-1',
        userId: 'user-1',
        groupId: 'group-1',
        welcomeData: 'welcome-data',
        acknowledged: false,
        createdAt: new Date()
      });

      const response = await request(app)
        .post('/v1/mls/welcomes/welcome-1/ack')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });

    it('returns 404 for non-existent welcome', async () => {
      const response = await request(app)
        .post('/v1/mls/welcomes/non-existent/ack')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
    });
  });
});
