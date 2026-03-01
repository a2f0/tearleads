import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();
const mockBroadcast = vi.fn((_c: string, _m: unknown) => Promise.resolve(1));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool()
}));

vi.mock('../../lib/broadcast.js', () => ({
  broadcast: (c: string, m: unknown) => mockBroadcast(c, m)
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
  getRedisClient: () => Promise.resolve(mockRedisClient),
  getRedisSubscriberOverride: () => mockRedisClient,
  setRedisSubscriberOverrideForTesting: vi.fn()
}));

describe('MLS VFS message route branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore.clear();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses valid cursor and clamps oversized limits', async () => {
    const authHeader = await createAuthHeader({
      id: 'user-1',
      email: 'user-1@example.com'
    });

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ role: 'member', organization_id: 'org-1' }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .get('/v1/vfs/mls/groups/group-1/messages?cursor=7&limit=250')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ messages: [], hasMore: false });
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        'WHERE ($3::integer IS NULL OR sequence_number < $3::integer)'
      ),
      ['group-1', 'mls_message:group-1:%', 7, 101]
    );
  });

  it('uses pool.connect transaction client when available', async () => {
    const authHeader = await createAuthHeader({
      id: 'user-1',
      email: 'user-1@example.com'
    });

    const mockClientQuery = vi.fn();
    const mockRelease = vi.fn();
    const mockConnect = vi.fn().mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease
    });

    mockGetPostgresPool.mockResolvedValueOnce({
      query: mockQuery,
      connect: mockConnect
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ role: 'member', organization_id: 'org-1' }]
    });
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .post('/v1/vfs/mls/groups/group-1/messages')
      .set('Authorization', authHeader)
      .send({
        ciphertext: 'ciphertext',
        epoch: 2,
        messageType: 'application'
      });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Group not found' });
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
