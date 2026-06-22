import { Database as SqliteDatabase } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  type BunSQLiteDatabase,
  drizzle as drizzleBunSqlite,
} from "drizzle-orm/bun-sqlite";
import { migrate as migrateBunSqlite } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePostgres } from "drizzle-orm/node-postgres/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import pg, { type PoolConfig } from "pg";
import * as schema from "../schema";
import { type ApiDatabaseKind, readApiDatabaseKind } from "../schema/dialect";
import { unsafeCoerce } from "../unsafeCoerce.js";

const { Pool } = pg;

export type { ApiDatabaseKind };

interface ApiDatabaseEnv {
  readonly API_DATABASE?: string | undefined;
  readonly DATABASE_URL?: string | undefined;
  readonly NODE_ENV?: string | undefined;
  readonly PGDATABASE?: string | undefined;
  readonly PGHOST?: string | undefined;
  readonly PGPASSWORD?: string | undefined;
  readonly PGPORT?: string | undefined;
  readonly PGUSER?: string | undefined;
  readonly POSTGRES_DATABASE?: string | undefined;
  readonly POSTGRES_HOST?: string | undefined;
  readonly POSTGRES_PASSWORD?: string | undefined;
  readonly POSTGRES_PORT?: string | undefined;
  readonly POSTGRES_SSL?: string | undefined;
  readonly POSTGRES_SSL_REJECT_UNAUTHORIZED?: string | undefined;
  readonly POSTGRES_URL?: string | undefined;
  readonly POSTGRES_USER?: string | undefined;
  readonly API_SQLITE_PATH?: string | undefined;
  readonly SQLITE_PATH?: string | undefined;
  readonly USER?: string | undefined;
  readonly LOGNAME?: string | undefined;
  readonly [key: string]: string | undefined;
}

type ApiSchema = typeof schema;
type ApiDatabaseSurface = Pick<
  PgliteDatabase<ApiSchema>,
  "delete" | "execute" | "insert" | "select" | "transaction" | "update"
>;
export type ApiDatabase = ApiDatabaseSurface;
type TransactionCallback = Parameters<ApiDatabase["transaction"]>[0];
export type DatabaseTransaction = Parameters<TransactionCallback>[0];
// Shared statement surface for helpers that can run against either the root
// database or an active transaction, without starting their own transaction.
export type DatabaseSession = Pick<
  ApiDatabase,
  "delete" | "execute" | "insert" | "select" | "update"
>;

const postgresMigrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);
const sqliteMigrationsFolder = fileURLToPath(
  new URL("../../drizzle-sqlite", import.meta.url),
);

export interface MigrationOptions {
  readonly migrationsFolder?: string;
}

export interface ManagedApiDatabase {
  readonly db: ApiDatabase;
  readonly kind: ApiDatabaseKind;
  close(): Promise<void>;
  migrate(options?: MigrationOptions): Promise<void>;
}

const databaseUrlKeys = ["DATABASE_URL", "POSTGRES_URL"] as const;
const hostKeys = ["POSTGRES_HOST", "PGHOST"] as const;
const portKeys = ["POSTGRES_PORT", "PGPORT"] as const;
const userKeys = ["POSTGRES_USER", "PGUSER"] as const;
const passwordKeys = ["POSTGRES_PASSWORD", "PGPASSWORD"] as const;
const databaseKeys = ["POSTGRES_DATABASE", "PGDATABASE"] as const;
const sqlitePathKeys = ["API_SQLITE_PATH", "SQLITE_PATH"] as const;
const postgresPoolSizing = {
  max: 15,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

function getEnvValue(
  env: ApiDatabaseEnv,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535
    ? parsed
    : undefined;
}

function isDevMode(env: ApiDatabaseEnv): boolean {
  return env.NODE_ENV === undefined || env.NODE_ENV === "development";
}

function getCurrentUser(env: ApiDatabaseEnv): string | undefined {
  const envUser = getEnvValue(env, ["USER", "LOGNAME"]);
  if (envUser) {
    return envUser;
  }

  try {
    const osUser = os.userInfo().username;
    return osUser.trim().length > 0 ? osUser : undefined;
  } catch {
    return undefined;
  }
}

function getPostgresDevDefaults(env: ApiDatabaseEnv): {
  readonly database: string;
  readonly host: string;
  readonly port: number;
  readonly user?: string;
} {
  const user = getCurrentUser(env);
  const defaults = {
    database: "tearleads_development",
    host: process.platform === "linux" ? "/var/run/postgresql" : "localhost",
    port: 5432,
  };

  return user ? { ...defaults, user } : defaults;
}

function readPostgresSslConfig(
  env: ApiDatabaseEnv,
): PoolConfig["ssl"] | undefined {
  const ssl = env.POSTGRES_SSL?.trim().toLowerCase();
  if (!ssl || ssl === "0" || ssl === "false") {
    return undefined;
  }

  const rejectUnauthorized =
    env.POSTGRES_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase();
  if (rejectUnauthorized === "0" || rejectUnauthorized === "false") {
    return { rejectUnauthorized: false };
  }

  return { rejectUnauthorized: true };
}

function requirePostgresEnv(
  env: ApiDatabaseEnv,
  key: string,
  missing: string[],
): string {
  const value = getEnvValue(env, [key]);
  if (value) {
    return value;
  }

  missing.push(String(key));
  return "";
}

export function createPostgresPoolConfig(
  env: ApiDatabaseEnv = process.env,
): PoolConfig {
  const ssl = readPostgresSslConfig(env);
  const databaseUrl = getEnvValue(env, databaseUrlKeys);
  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      ...postgresPoolSizing,
      ...(ssl ? { ssl } : {}),
    };
  }

  if (!isDevMode(env)) {
    const missing: string[] = [];
    const host = requirePostgresEnv(env, "POSTGRES_HOST", missing);
    const portValue = requirePostgresEnv(env, "POSTGRES_PORT", missing);
    const user = requirePostgresEnv(env, "POSTGRES_USER", missing);
    const password = requirePostgresEnv(env, "POSTGRES_PASSWORD", missing);
    const database = requirePostgresEnv(env, "POSTGRES_DATABASE", missing);

    if (missing.length > 0) {
      throw new Error(
        `Missing required Postgres environment variables: ${missing.join(", ")}`,
      );
    }

    const port = parsePort(portValue);
    if (port === undefined) {
      throw new Error("POSTGRES_PORT must be a valid number");
    }

    return {
      database,
      host,
      password,
      port,
      user,
      ...postgresPoolSizing,
      ...(ssl ? { ssl } : {}),
    };
  }

  const defaults = getPostgresDevDefaults(env);
  const host = getEnvValue(env, hostKeys) ?? defaults.host;
  const port = parsePort(getEnvValue(env, portKeys)) ?? defaults.port;
  const user = getEnvValue(env, userKeys) ?? defaults.user;
  const password = getEnvValue(env, passwordKeys);
  const database = getEnvValue(env, databaseKeys) ?? defaults.database;

  return {
    ...(host ? { host } : {}),
    ...(port ? { port } : {}),
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
    ...(database ? { database } : {}),
    ...postgresPoolSizing,
    ...(ssl ? { ssl } : {}),
  };
}

function attachSqliteExecute(
  db: BunSQLiteDatabase<ApiSchema>,
): BunSQLiteDatabase<ApiSchema> & Pick<ApiDatabaseSurface, "execute"> {
  const database = unsafeCoerce<{
    execute(query: Parameters<ApiDatabaseSurface["execute"]>[0]): Promise<{
      readonly rows: readonly unknown[];
    }>;
  }>(db);
  database.execute = (query: Parameters<ApiDatabaseSurface["execute"]>[0]) =>
    Promise.resolve({
      rows: db.all(query),
    });
  return unsafeCoerce<
    BunSQLiteDatabase<ApiSchema> & Pick<ApiDatabaseSurface, "execute">
  >(database);
}

function createSqliteApiDatabase(env: ApiDatabaseEnv): ManagedApiDatabase {
  const sqlitePath = getEnvValue(env, sqlitePathKeys) ?? ":memory:";
  const client = new SqliteDatabase(sqlitePath, { create: true });
  client.exec("PRAGMA foreign_keys = ON");
  const sqliteDb = attachSqliteExecute(drizzleBunSqlite({ client, schema }));
  const transactionContext = new AsyncLocalStorage<{
    readonly depth: number;
  }>();
  let transactionQueue = Promise.resolve();
  let savepointCounter = 0;

  const transactionDb = unsafeCoerce<DatabaseTransaction>(sqliteDb);
  const runSqliteTransaction = async (callback: TransactionCallback) => {
    const activeTransaction = transactionContext.getStore();
    if (activeTransaction) {
      const savepointName = `tearleads_sp_${++savepointCounter}`;
      client.exec(`savepoint ${savepointName}`);
      try {
        const result = await transactionContext.run(
          { depth: activeTransaction.depth + 1 },
          () => callback(transactionDb),
        );
        client.exec(`release savepoint ${savepointName}`);
        return result;
      } catch (error) {
        client.exec(`rollback to savepoint ${savepointName}`);
        client.exec(`release savepoint ${savepointName}`);
        throw error;
      }
    }

    const run = () =>
      transactionContext.run({ depth: 0 }, async () => {
        client.exec("begin immediate");
        try {
          const result = await callback(transactionDb);
          client.exec("commit");
          return result;
        } catch (error) {
          client.exec("rollback");
          throw error;
        }
      });

    const result = transactionQueue.then(run, run);
    transactionQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const dbBridge = unsafeCoerce<{
    transaction(callback: TransactionCallback): Promise<unknown>;
  }>(sqliteDb);
  dbBridge.transaction = runSqliteTransaction;

  return {
    db: unsafeCoerce<ApiDatabase>(dbBridge),
    kind: "sqlite",
    close: async () => client.close(),
    migrate: async (options) => {
      migrateBunSqlite(sqliteDb, {
        migrationsFolder: options?.migrationsFolder ?? sqliteMigrationsFolder,
      });
    },
  };
}

function createMemoryApiDatabase(): ManagedApiDatabase {
  const client = new PGlite({ dataDir: "memory://", debug: 0 });
  const db = drizzle({ client, schema });

  return {
    db,
    kind: "memory",
    close: () => client.close(),
    migrate: (options) =>
      migrate(db, {
        migrationsFolder: options?.migrationsFolder ?? postgresMigrationsFolder,
      }),
  };
}

function createPostgresApiDatabase(env: ApiDatabaseEnv): ManagedApiDatabase {
  const pool = new Pool(createPostgresPoolConfig(env));
  const db = drizzleNodePostgres({ client: pool, schema });

  return {
    db,
    kind: "postgres",
    close: () => pool.end(),
    migrate: (options) =>
      migrateNodePostgres(db, {
        migrationsFolder: options?.migrationsFolder ?? postgresMigrationsFolder,
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
    return createSqliteApiDatabase(env);
  }

  return createPostgresApiDatabase(env);
}

const defaultDatabase = createDefaultManagedApiDatabase();
let defaultDatabaseMigration: Promise<void> | undefined;

export function getDefaultApiDatabaseKind(): ApiDatabaseKind {
  return defaultDatabase.kind;
}

export function initializeApiDatabase(
  options?: MigrationOptions,
): Promise<void> {
  defaultDatabaseMigration ??= defaultDatabase.migrate(options);
  return defaultDatabaseMigration;
}

export const db = defaultDatabase.db;

export async function closeApiDatabase(): Promise<void> {
  try {
    await defaultDatabaseMigration;
  } finally {
    await defaultDatabase.close();
  }
}

export default defaultDatabase;
