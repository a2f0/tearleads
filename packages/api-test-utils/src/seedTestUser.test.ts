import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedTestUser } from './seedTestUser.js';
import { createTestContext, type TestContext } from './testContext.js';

describe('seedTestUser', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext(async () => {
      const api = await import('@tearleads/api');
      return { app: api.app, migrations: api.migrations };
    });
  });

  beforeEach(async () => {
    await ctx.resetState();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  it('should create a user and return credentials', async () => {
    const user = await seedTestUser(ctx);
    expect(user.userId).toBeTruthy();
    expect(user.email).toContain('@test.local');
    expect(user.accessToken).toBeTruthy();
    expect(user.sessionId).toBeTruthy();
  });

  it('should create a user that exists in the database', async () => {
    const user = await seedTestUser(ctx);
    const result = await ctx.pool.query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [user.userId]
    );
    expect(result.rows[0]?.email).toBe(user.email);
  });

  it('should create a valid session in Redis', async () => {
    const user = await seedTestUser(ctx);
    const sessionKey = `session:${user.sessionId}`;
    const raw = await ctx.redis.get(sessionKey);
    expect(raw).toBeTruthy();
    const session = JSON.parse(raw ?? '');
    expect(session.userId).toBe(user.userId);
    expect(session.email).toBe(user.email);
  });

  it('should produce a token that authenticates against the API', async () => {
    const user = await seedTestUser(ctx);
    const response = await fetch(`${ctx.baseUrl}/v1/auth/sessions`, {
      headers: { Authorization: `Bearer ${user.accessToken}` }
    });
    expect(response.status).toBe(200);
  });

  it('should accept custom email', async () => {
    const user = await seedTestUser(ctx, { email: 'custom@example.com' });
    expect(user.email).toBe('custom@example.com');
  });
});
