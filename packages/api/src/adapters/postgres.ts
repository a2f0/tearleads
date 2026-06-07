import os from "node:os";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  drizzle as drizzleNodePostgres,
  type NodePgDatabase,
} from "drizzle-orm/node-postgres";
import { migrate as migrateNodePostgres } from "drizzle-orm/node-postgres/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import pg, { type PoolConfig } from "pg";
import * as schema from "../schema";

const { Pool } = pg;

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
  readonly USER?: string | undefined;
  readonly LOGNAME?: string | undefined;
  readonly [key: string]: string | undefined;
}

type ApiDatabaseKind = "memory" | "postgres";

type ApiSchema = typeof schema;
type ConcreteApiDatabase =
  | NodePgDatabase<ApiSchema>
  | PgliteDatabase<ApiSchema>;
type ApiDatabaseSurface = Pick<
  PgliteDatabase<ApiSchema>,
  "delete" | "execute" | "insert" | "select" | "transaction" | "update"
>;
export type ApiDatabase = ConcreteApiDatabase & ApiDatabaseSurface;
type TransactionCallback = Parameters<ApiDatabase["transaction"]>[0];
export type DatabaseTransaction = Parameters<TransactionCallback>[0];
// Shared statement surface for helpers that can run against either the root
// database or an active transaction, without starting their own transaction.
export type DatabaseSession = Pick<
  ApiDatabase,
  "delete" | "execute" | "insert" | "select" | "update"
>;

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

export interface ManagedApiDatabase {
  readonly db: ApiDatabase;
  readonly kind: ApiDatabaseKind;
  close(): Promise<void>;
  migrate(): Promise<void>;
}

const databaseUrlKeys = ["DATABASE_URL", "POSTGRES_URL"] as const;
const hostKeys = ["POSTGRES_HOST", "PGHOST"] as const;
const portKeys = ["POSTGRES_PORT", "PGPORT"] as const;
const userKeys = ["POSTGRES_USER", "PGUSER"] as const;
const passwordKeys = ["POSTGRES_PASSWORD", "PGPASSWORD"] as const;
const databaseKeys = ["POSTGRES_DATABASE", "PGDATABASE"] as const;
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

function readApiDatabaseKind(env: ApiDatabaseEnv): ApiDatabaseKind {
  const value = getEnvValue(env, ["API_DATABASE"]) ?? "memory";
  if (value === "memory" || value === "pglite") {
    return "memory";
  }
  if (value === "postgres") {
    return "postgres";
  }

  throw new Error(`Unsupported API_DATABASE value: ${value}`);
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

function createMemoryApiDatabase(): ManagedApiDatabase {
  const client = new PGlite({ debug: 0 });
  const db = drizzle({ client, schema });

  return {
    db,
    kind: "memory",
    close: () => client.close(),
    migrate: () => migrate(db, { migrationsFolder }),
  };
}

function createPostgresApiDatabase(env: ApiDatabaseEnv): ManagedApiDatabase {
  const pool = new Pool(createPostgresPoolConfig(env));
  const db = drizzleNodePostgres({ client: pool, schema });

  return {
    db,
    kind: "postgres",
    close: () => pool.end(),
    migrate: () => migrateNodePostgres(db, { migrationsFolder }),
  };
}

export function createDefaultManagedApiDatabase(
  env: ApiDatabaseEnv = process.env,
): ManagedApiDatabase {
  const kind = readApiDatabaseKind(env);
  if (kind === "memory") {
    return createMemoryApiDatabase();
  }

  return createPostgresApiDatabase(env);
}

const defaultDatabase = createDefaultManagedApiDatabase();
let defaultDatabaseMigration: Promise<void> | undefined;

export function initializeApiDatabase(): Promise<void> {
  defaultDatabaseMigration ??= defaultDatabase.migrate();
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
