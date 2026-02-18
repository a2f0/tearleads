/**
 * Ergonomic wrapper for testing with a real SQLite database.
 *
 * Provides automatic setup, migration running, and cleanup.
 */

import type { Database } from '@tearleads/db/sqlite';
import { schema } from '@tearleads/db/sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { DatabaseAdapter } from './adapters/types.js';
import type { WasmNodeAdapterOptions } from './adapters/wasmNode.adapter.js';
import { WasmNodeAdapter } from './adapters/wasmNode.adapter.js';
import { TestKeyManager } from './testKeyManager.js';

/**
 * Migration definition for running database migrations.
 */
export interface Migration {
  version: number;
  up: (adapter: DatabaseAdapter) => Promise<void>;
}

/**
 * Context provided to test callbacks.
 */
export interface TestDatabaseContext {
  /** Drizzle database instance for ORM operations */
  db: Database;
  /** Raw adapter for direct SQL execution */
  adapter: WasmNodeAdapter;
  /** Key manager instance */
  keyManager: TestKeyManager;
}

/**
 * Options for withRealDatabase.
 */
export interface WithRealDatabaseOptions extends WasmNodeAdapterOptions {
  /**
   * Migrations to run after database creation.
   * If not provided, no migrations are run (bare database).
   */
  migrations?: Migration[];

  /**
   * Instance ID for database naming. Default: 'test-instance'
   */
  instanceId?: string;
}

/**
 * Run migrations on the adapter.
 * Simplified version that doesn't track applied migrations.
 */
async function runMigrations(
  adapter: DatabaseAdapter,
  migrations: Migration[]
): Promise<void> {
  const sortedMigrations = migrations
    .slice()
    .sort((a, b) => a.version - b.version);

  for (const migration of sortedMigrations) {
    await migration.up(adapter);
  }
}

/**
 * Creates a test database context with adapter and Drizzle instance.
 *
 * Use this when you need long-lived database access or want to manage
 * the lifecycle yourself. Remember to call adapter.close() when done.
 *
 * @example
 * ```ts
 * const { db, adapter, keyManager } = await createTestDatabase();
 * try {
 *   await db.insert(users).values({ ... });
 * } finally {
 *   await adapter.close();
 * }
 * ```
 */
export async function createTestDatabase(
  options: WithRealDatabaseOptions = {}
): Promise<TestDatabaseContext> {
  const {
    migrations,
    instanceId = 'test-instance',
    skipEncryption = false,
    wasmDir
  } = options;

  const keyManager = new TestKeyManager();
  keyManager.setIsSetUp(true);
  const encryptionKey = TestKeyManager.getTestKey();

  const adapterOptions: WasmNodeAdapterOptions = { skipEncryption };
  if (wasmDir !== undefined) {
    adapterOptions.wasmDir = wasmDir;
  }
  const adapter = new WasmNodeAdapter(adapterOptions);
  await adapter.initialize({
    name: `test-${instanceId}-${Date.now()}`,
    encryptionKey,
    location: 'default'
  });

  // Create Drizzle instance
  const connection = adapter.getConnection();
  const db = drizzle(connection as Parameters<typeof drizzle>[0], { schema });

  // Run migrations if provided
  if (migrations && migrations.length > 0) {
    await runMigrations(adapter, migrations);
  }

  return { db, adapter, keyManager };
}

/**
 * Run a test with a real SQLite database.
 *
 * Automatically sets up the database, runs migrations (if provided),
 * executes your callback, and cleans up afterward.
 *
 * @example
 * ```ts
 * import { withRealDatabase, seedFolder } from '@tearleads/db-test-utils';
 * import { migrations } from '@tearleads/db/migrations';
 * import { vfsLinks } from '@tearleads/db/sqlite';
 *
 * it('creates link when copying', async () => {
 *   await withRealDatabase(async ({ db }) => {
 *     const folderId = await seedFolder(db, { name: 'Target' });
 *
 *     // ... perform operations ...
 *
 *     const links = await db.select().from(vfsLinks);
 *     expect(links).toHaveLength(1);
 *   }, { migrations });
 * });
 * ```
 */
export async function withRealDatabase<T>(
  callback: (context: TestDatabaseContext) => Promise<T>,
  options: WithRealDatabaseOptions = {}
): Promise<T> {
  const context = await createTestDatabase(options);

  try {
    return await callback(context);
  } finally {
    await context.adapter.close();
  }
}
