import type { Server } from 'node:http';
import { setPoolOverrideForTesting } from '@tearleads/api/lib/postgres';
import { setRedisSubscriberOverrideForTesting } from '@tearleads/api/lib/redisPubSub';
import { runMigrations } from '@tearleads/api/migrations';
import type { RedisClient } from '@tearleads/shared/redis';
import { setRedisClientOverrideForTesting } from '@tearleads/shared/redis';
import type { Pool as PgPool } from 'pg';
import type { Express } from 'express';
import { createPglitePool } from './pglitePool.js';
import { createRedisMock, type RedisMockClient } from './redisMock.js';

export interface TestContext {
  pool: PgPool;
  redis: RedisMockClient;
  app: Express;
  server: Server;
  port: number;
  baseUrl: string;
  resetState: () => Promise<void>;
  teardown: () => Promise<void>;
}

async function getAllUserTableNames(pool: PgPool): Promise<string[]> {
  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename != 'schema_migrations'`
  );
  return result.rows.map((r) => r.tablename);
}

export async function createTestContext(): Promise<TestContext> {
  // 1. Create PGlite pool
  const { pool, exec } = await createPglitePool();

  // 2. Inject pool override
  setPoolOverrideForTesting(pool);

  // 3. Create txid_current() stub for PGlite compatibility (used by v021)
  await exec(
    `CREATE OR REPLACE FUNCTION txid_current() RETURNS BIGINT
     LANGUAGE SQL AS $$ SELECT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT $$;`
  );

  // 4. Run migrations
  await runMigrations(pool);

  // 5. Create Redis mock, inject overrides
  const redis = createRedisMock();
  setRedisClientOverrideForTesting(redis as unknown as RedisClient);
  setRedisSubscriberOverrideForTesting(redis.duplicate() as unknown as RedisClient);

  // 6. Set required env vars
  process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-jwt-secret-for-api-test-utils';
  process.env['NODE_ENV'] = 'test';

  // Set dummy Postgres env vars for getPostgresConnectionInfo() display (queries use PGlite override)
  process.env['POSTGRES_HOST'] = process.env['POSTGRES_HOST'] ?? 'pglite';
  process.env['POSTGRES_PORT'] = process.env['POSTGRES_PORT'] ?? '5432';
  process.env['POSTGRES_USER'] = process.env['POSTGRES_USER'] ?? 'test';
  process.env['POSTGRES_PASSWORD'] = process.env['POSTGRES_PASSWORD'] ?? 'test';
  process.env['POSTGRES_DATABASE'] = process.env['POSTGRES_DATABASE'] ?? 'test';

  // 7. Import and start Express app
  const { app } = await import('@tearleads/api');
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const address = server.address();
  const port =
    address && typeof address === 'object' ? address.port : 0;
  const baseUrl = `http://localhost:${String(port)}`;

  // Cache table names after migrations
  let tableNames: string[] | null = null;

  const resetState = async (): Promise<void> => {
    if (!tableNames) {
      tableNames = await getAllUserTableNames(pool);
    }
    if (tableNames.length > 0) {
      const quoted = tableNames.map((t) => `"${t}"`).join(', ');
      await pool.query(`TRUNCATE ${quoted} CASCADE`);
    }
    await redis.flushAll();
  };

  const teardown = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    setPoolOverrideForTesting(null);
    setRedisClientOverrideForTesting(null);
    setRedisSubscriberOverrideForTesting(null);
    await pool.end();
  };

  return {
    pool,
    redis,
    app,
    server,
    port,
    baseUrl,
    resetState,
    teardown
  };
}
