#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import os from "node:os";

interface ConnectionParts {
  readonly database: string | null;
  readonly host: string | null;
  readonly password: string | null;
  readonly port: number | null;
  readonly user: string | null;
}

interface CliOptions {
  readonly database: string | undefined;
  readonly databaseUrl: string | undefined;
  readonly yes: boolean;
}

interface PsqlEnvironment extends Record<string, string> {
  PGDATABASE: string;
  PGHOST?: string;
  PGPASSWORD?: string;
  PGPORT?: string;
  PGUSER?: string;
}

const allowedDatabase = "symcrypt_development";
const deniedDatabase = "symcrypt_production";

function parseArgs(args: readonly string[]): CliOptions {
  let database: string | undefined;
  let databaseUrl: string | undefined;
  let yes = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--yes") {
      yes = true;
      continue;
    }
    if (arg === "--database") {
      database = args[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--database=")) {
      database = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--database-url") {
      databaseUrl = args[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--database-url=")) {
      databaseUrl = arg.split("=", 2)[1];
    }
  }

  return { database, databaseUrl, yes };
}

function getEnvValue(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function parsePort(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function currentUser(): string | null {
  const envUser = getEnvValue(["USER", "LOGNAME"]);
  if (envUser) {
    return envUser;
  }
  try {
    const username = os.userInfo().username;
    return username.trim().length > 0 ? username : null;
  } catch {
    return null;
  }
}

function devDefaults(): ConnectionParts {
  return {
    database: allowedDatabase,
    host: process.platform === "linux" ? "/var/run/postgresql" : "localhost",
    password: null,
    port: 5432,
    user: currentUser(),
  };
}

function parseDatabaseUrl(databaseUrl: string): ConnectionParts {
  const parsed = new URL(databaseUrl);
  const portValue = parsed.port ? Number(parsed.port) : null;
  const database = parsed.pathname
    ? decodeURIComponent(parsed.pathname.replace(/^\//, ""))
    : null;

  return {
    database: database || null,
    host: parsed.hostname || null,
    password: parsed.password ? decodeURIComponent(parsed.password) : null,
    port: Number.isFinite(portValue ?? Number.NaN) ? portValue : null,
    user: parsed.username ? decodeURIComponent(parsed.username) : null,
  };
}

function buildConnectionParts(
  databaseUrl: string | undefined,
): ConnectionParts {
  if (databaseUrl) {
    return parseDatabaseUrl(databaseUrl);
  }

  const defaults = devDefaults();
  return {
    database:
      getEnvValue(["POSTGRES_DATABASE", "PGDATABASE"]) ?? defaults.database,
    host: getEnvValue(["POSTGRES_HOST", "PGHOST"]) ?? defaults.host,
    password: getEnvValue(["POSTGRES_PASSWORD", "PGPASSWORD"]) ?? null,
    port: parsePort(getEnvValue(["POSTGRES_PORT", "PGPORT"])) ?? defaults.port,
    user: getEnvValue(["POSTGRES_USER", "PGUSER"]) ?? defaults.user,
  };
}

function buildPsqlEnv(parts: ConnectionParts): Record<string, string> {
  const env: PsqlEnvironment = { PGDATABASE: "postgres" };
  if (parts.host !== null) env.PGHOST = parts.host;
  if (parts.password !== null) env.PGPASSWORD = parts.password;
  if (parts.port !== null) env.PGPORT = String(parts.port);
  if (parts.user !== null) env.PGUSER = parts.user;
  return env;
}

const options = parseArgs(process.argv.slice(2));
const databaseUrl =
  options.databaseUrl ?? getEnvValue(["DATABASE_URL", "POSTGRES_URL"]);
const parts = buildConnectionParts(databaseUrl);
const targetDatabase = options.database ?? parts.database;

if (!targetDatabase) {
  console.error(
    "Missing database name. Set DATABASE_URL or PGDATABASE/POSTGRES_DATABASE, or pass --database.",
  );
  process.exit(1);
}
if (targetDatabase === deniedDatabase) {
  console.error(`Refusing to drop database "${targetDatabase}".`);
  process.exit(1);
}
if (targetDatabase !== allowedDatabase) {
  console.error(
    `Refusing to drop database "${targetDatabase}". Only "${allowedDatabase}" is allowed.`,
  );
  process.exit(1);
}
if (!options.yes) {
  console.error(
    `Refusing to drop database "${targetDatabase}" without --yes confirmation.`,
  );
  process.exit(1);
}

const safeDatabaseLiteral = targetDatabase.replace(/'/g, "''");
const safeDatabaseIdentifier = targetDatabase.replace(/"/g, '""');
const terminateSql =
  `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${safeDatabaseLiteral}' ` +
  "AND pid <> pg_backend_pid();";
const dropSql = `DROP DATABASE IF EXISTS "${safeDatabaseIdentifier}";`;

try {
  execFileSync("psql", ["--set=ON_ERROR_STOP=1", "-c", terminateSql], {
    env: { ...process.env, ...buildPsqlEnv(parts) },
    stdio: "inherit",
  });
  execFileSync("psql", ["--set=ON_ERROR_STOP=1", "-c", dropSql], {
    env: { ...process.env, ...buildPsqlEnv(parts) },
    stdio: "inherit",
  });
} catch (error) {
  console.error(
    "Failed to drop database. Ensure psql is installed and reachable.",
  );
  throw error;
}
