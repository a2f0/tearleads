import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePostgres } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import * as schema from "../schema";
import { readApiDatabaseKind } from "../schema/dialect";
import { databaseStatementLogger } from "./databaseStatementCounter";
import {
  type ApiDatabaseEnv,
  createPostgresPoolConfig,
  isEnabled,
  readPostgresStreamConfig,
  readSqlitePath,
} from "./postgresConfig";
import { createSqliteApiDatabase } from "./sqliteAdapter";
import { withDatabaseTransactionCompletion } from "./transactionCompletion";
import { createTursoApiDatabase } from "./tursoAdapter";
import type {
  ApiDatabase,
  ApiDatabaseKind,
  ManagedApiDatabase,
  MigrationOptions,
} from "./types";

const { Pool } = pg;

export { withDatabaseStatementCounter } from "./databaseStatementCounter";
export { gatherWithExecutor, isDatabaseTransaction } from "./executor";
export { createPostgresPoolConfig } from "./postgresConfig";
export { databaseTransactionCompletion } from "./transactionCompletion";

export type {
  ApiDatabase,
  ApiDatabaseKind,
  ApiDatabaseSurface,
  ApiSchema,
  DatabaseSession,
  DatabaseTransaction,
  ManagedApiDatabase,
  MigrationOptions,
  TransactionCallback,
} from "./types";

// Resolved on demand: the Workers bundle has no file URL for this module, and
// it never migrates, so resolving at import time would throw there.
function postgresMigrationsFolder(): string {
  return fileURLToPath(new URL("../../drizzle", import.meta.url));
}
function sqliteMigrationsFolder(): string {
  return fileURLToPath(new URL("../../drizzle-sqlite", import.meta.url));
}

function createMemoryApiDatabase(): ManagedApiDatabase {
  const client = new PGlite({ dataDir: "memory://", debug: 0 });
  const db = drizzle({ client, schema, logger: databaseStatementLogger });

  return {
    db: withDatabaseTransactionCompletion(db),
    kind: "memory",
    close: () => client.close(),
    migrate: (options) =>
      migrate(db, {
        migrationsFolder:
          options?.migrationsFolder ?? postgresMigrationsFolder(),
      }),
  };
}

function createPostgresApiDatabase(
  env: ApiDatabaseEnv,
  options: { readonly requestScoped?: boolean } = {},
): ManagedApiDatabase {
  // pg types its stream factory as a Node Duplex; the Workers socket is a
  // structural stand-in, so it joins the config outside the typed literal.
  const pool = new Pool(
    Object.assign(
      createPostgresPoolConfig(env, options),
      readPostgresStreamConfig(env),
    ),
  );
  const db = drizzleNodePostgres({
    client: pool,
    schema,
    logger: databaseStatementLogger,
  });

  return {
    db: withDatabaseTransactionCompletion(db),
    kind: "postgres",
    close: () => pool.end(),
    migrate: (options) =>
      migrateNodePostgres(db, {
        migrationsFolder:
          options?.migrationsFolder ?? postgresMigrationsFolder(),
      }),
  };
}

export function createDefaultManagedApiDatabase(
  env: ApiDatabaseEnv = process.env,
): ManagedApiDatabase {
  const kind = readApiDatabaseKind(env);
  if (kind === "memory") {
    return createMemoryApiDatabase();
  }
  if (kind === "sqlite") {
    return createSqliteApiDatabase({
      sqlitePath: readSqlitePath(env),
      migrationsFolder: sqliteMigrationsFolder(),
    });
  }
  if (kind === "turso") {
    return createTursoApiDatabase(env, sqliteMigrationsFolder());
  }

  return createPostgresApiDatabase(env);
}

const defaultDatabase = createDefaultManagedApiDatabase();
let defaultDatabaseMigration: Promise<void> | undefined;

/**
 * On Workers a socket belongs to the request that opened it, so a pooled
 * connection reused by a later request never answers. With
 * `POSTGRES_REQUEST_SCOPED=true` each request runs against its own pool,
 * created by `withRequestScopedApiDatabase` and closed after the request;
 * `db` resolves to the current request's pool. Work outside a request scope
 * (the realtime hub's timers) falls back to the process-wide default, whose
 * clients retire after one checkout.
 */
const requestScopedDatabases = new AsyncLocalStorage<ManagedApiDatabase>();

export function isRequestScopedPostgres(
  env: ApiDatabaseEnv = process.env,
): boolean {
  return (
    isEnabled(env.POSTGRES_REQUEST_SCOPED) &&
    readApiDatabaseKind(env) === "postgres"
  );
}

export async function withRequestScopedApiDatabase<T>(
  run: () => Promise<T>,
  settle: (closing: Promise<void>) => void = () => {},
): Promise<T> {
  if (!isRequestScopedPostgres()) {
    return run();
  }
  const database = createPostgresApiDatabase(process.env, {
    requestScoped: true,
  });
  try {
    return await requestScopedDatabases.run(database, run);
  } finally {
    settle(
      database.close().catch((error: unknown) => {
        console.error("Failed to close the request database:", error);
      }),
    );
  }
}

/**
 * A stable database handle that forwards each access to `current()`. The
 * fallback only gives the proxy its shape; every access resolves afresh.
 */
export function createRequestScopedDatabaseProxy(
  fallback: ApiDatabase,
  current: () => ApiDatabase,
): ApiDatabase {
  return new Proxy(fallback, {
    get(_target, property) {
      const target = current();
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function getDefaultApiDatabaseKind(): ApiDatabaseKind {
  return defaultDatabase.kind;
}

export function initializeApiDatabase(
  options?: MigrationOptions,
): Promise<void> {
  defaultDatabaseMigration ??= defaultDatabase.migrate(options);
  return defaultDatabaseMigration;
}

export const db: ApiDatabase = isRequestScopedPostgres()
  ? createRequestScopedDatabaseProxy(
      defaultDatabase.db,
      () => (requestScopedDatabases.getStore() ?? defaultDatabase).db,
    )
  : defaultDatabase.db;

export async function closeApiDatabase(): Promise<void> {
  try {
    await defaultDatabaseMigration;
  } finally {
    await defaultDatabase.close();
  }
}

export default defaultDatabase;
