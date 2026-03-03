import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import request from '../../test/connectCompatRequest.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool()
}));

describe('MLS legacy routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 404 for /v1/mls routes without auth', async () => {
    const response = await request(app).get('/v1/mls/key-packages/user-2');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not found' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 404 for /v1/mls routes with auth', async () => {
    const authHeader = await createAuthHeader({
      id: 'user-1',
      email: 'user-1@example.com'
    });

    const getResponse = await request(app)
      .get('/v1/mls/key-packages/user-2')
      .set('Authorization', authHeader);

    const postResponse = await request(app)
      .post('/v1/mls/groups')
      .set('Authorization', authHeader)
      .send({
        name: 'Group Name',
        groupIdMls: 'group-id-mls',
        cipherSuite: 1
      });

    const ackResponse = await request(app)
      .post('/v1/mls/welcome-messages/welcome-1/ack')
      .set('Authorization', authHeader)
      .send({ groupId: 'group-1' });

    expect(getResponse.status).toBe(404);
    expect(getResponse.body).toEqual({ error: 'Not found' });
    expect(postResponse.status).toBe(404);
    expect(postResponse.body).toEqual({ error: 'Not found' });
    expect(ackResponse.status).toBe(404);
    expect(ackResponse.body).toEqual({ error: 'Not found' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
