import type { Server } from 'node:http';
import type { Migration } from '@tearleads/db/migrations';
import { runMigrations } from '@tearleads/db/migrations';
import type { RedisClient } from '@tearleads/shared/redis';
import {
  setRedisClientOverrideForTesting,
  setRedisSubscriberOverrideForTesting
} from '@tearleads/shared/redis';
import { setPoolOverrideForTesting } from '@tearleads/shared/testing';
import type { Express } from 'express';
import type { Pool as PgPool } from 'pg';
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

/**
 * Dependencies that must be provided by the consumer.
 * This avoids a direct dependency on @tearleads/api.
 */
export interface TestContextDeps {
  app: Express;
  migrations: Migration[];
}

async function getAllUserTableNames(pool: PgPool): Promise<string[]> {
  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename != 'schema_migrations'`
  );
  return result.rows.map((r) => r.tablename);
}

export async function createTestContext(
  getDeps: () => Promise<TestContextDeps>
): Promise<TestContext> {
  // 1. Create PGlite pool
  const { pool, exec } = await createPglitePool();

  // 2. Inject pool override
  setPoolOverrideForTesting(pool);

  // 3. Create txid_current() stub for PGlite compatibility (used by v021)
  await exec(
    `CREATE OR REPLACE FUNCTION txid_current() RETURNS BIGINT
     LANGUAGE SQL AS $$ SELECT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT $$;`
  );

  // 4. Create Redis mock, inject overrides
  const redis = createRedisMock();
  setRedisClientOverrideForTesting(redis as unknown as RedisClient);
  setRedisSubscriberOverrideForTesting(
    redis.duplicate() as unknown as RedisClient
  );

  // 5. Set required env vars
  process.env['JWT_SECRET'] =
    process.env['JWT_SECRET'] ?? 'test-jwt-secret-for-api-test-utils';
  process.env['NODE_ENV'] = 'test';

  process.env['POSTGRES_HOST'] = process.env['POSTGRES_HOST'] ?? 'pglite';
  process.env['POSTGRES_PORT'] = process.env['POSTGRES_PORT'] ?? '5432';
  process.env['POSTGRES_USER'] = process.env['POSTGRES_USER'] ?? 'test';
  process.env['POSTGRES_PASSWORD'] = process.env['POSTGRES_PASSWORD'] ?? 'test';
  process.env['POSTGRES_DATABASE'] = process.env['POSTGRES_DATABASE'] ?? 'test';

  // 6. Load app and migrations from consumer
  const { app, migrations } = await getDeps();

  // 7. Run migrations
  await runMigrations(pool, migrations);

  // 8. Start Express server on random port
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
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
