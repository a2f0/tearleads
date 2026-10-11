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
import { createRequestScopedDatabaseRuntime } from "./requestScopedDatabase";
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

export function isRequestScopedPostgres(
  env: ApiDatabaseEnv = process.env,
): boolean {
  return (
    isEnabled(env.POSTGRES_REQUEST_SCOPED) &&
    readApiDatabaseKind(env) === "postgres"
  );
}

// See requestScopedDatabase.ts: with `POSTGRES_REQUEST_SCOPED=true` each
// request runs against its own pool and `db` resolves to it, while work
// outside a request scope (the realtime hub's timers) falls back to the
// process-wide default, whose clients retire after one checkout.
const requestScope = isRequestScopedPostgres()
  ? createRequestScopedDatabaseRuntime({
      create: () =>
        createPostgresApiDatabase(process.env, { requestScoped: true }),
      fallback: defaultDatabase,
    })
  : undefined;

export async function withRequestScopedApiDatabase<T>(
  run: () => Promise<T>,
  settle: (closing: Promise<void>) => void = () => {},
): Promise<T> {
  return requestScope ? requestScope.run(run, settle) : run();
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

export const db: ApiDatabase = requestScope?.db ?? defaultDatabase.db;

export async function closeApiDatabase(): Promise<void> {
  try {
    await defaultDatabaseMigration;
  } finally {
    await defaultDatabase.close();
  }
}

export default defaultDatabase;
