import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './testContext.js';

describe('TestContext', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  it('should have migrations applied', async () => {
    const result = await ctx.pool.query<{ version: number }>(
      'SELECT MAX(version) AS version FROM schema_migrations'
    );
    expect(result.rows[0]?.version).toBeGreaterThanOrEqual(25);
  });

  it('should have user tables created', async () => {
    const result = await ctx.pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it('should serve HTTP requests', async () => {
    const response = await fetch(`${ctx.baseUrl}/v1/ping`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('version');
  });

  it('should reset state', async () => {
    await ctx.pool.query(
      "INSERT INTO organizations (id, name, is_personal, created_at, updated_at) VALUES ('test-org', 'Test Org', TRUE, NOW(), NOW())"
    );
    await ctx.pool.query(
      "INSERT INTO users (id, email, personal_organization_id, created_at, updated_at) VALUES ('test-id', 'test@test.local', 'test-org', NOW(), NOW())"
    );
    await ctx.redis.set('testkey', 'testvalue');

    await ctx.resetState();

    const userResult = await ctx.pool.query('SELECT COUNT(*) AS count FROM users');
    expect(Number(userResult.rows[0]?.count)).toBe(0);
    expect(await ctx.redis.get('testkey')).toBeNull();
  });
});
