import { afterAll, expect, test } from "bun:test";
import type { ManagedApiDatabase } from "./postgres";
import {
  closeApiDatabase,
  createDefaultManagedApiDatabase,
  createPostgresPoolConfig,
} from "./postgres";

afterAll(async () => {
  await closeApiDatabase();
});

function expectedDevHost(): string {
  return process.platform === "linux" ? "/var/run/postgresql" : "localhost";
}

test("Postgres pool config uses DATABASE_URL when provided", () => {
  expect(
    createPostgresPoolConfig({
      DATABASE_URL: "postgres://dev-user@localhost:5432/tearleads_dev",
      NODE_ENV: "development",
    }),
  ).toEqual({
    connectionString: "postgres://dev-user@localhost:5432/tearleads_dev",
    max: 15,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
});

test("Postgres pool config applies SSL settings to DATABASE_URL", () => {
  expect(
    createPostgresPoolConfig({
      DATABASE_URL: "postgres://dev-user@localhost:5432/tearleads_dev",
      POSTGRES_SSL: "true",
    }),
  ).toMatchObject({
    connectionString: "postgres://dev-user@localhost:5432/tearleads_dev",
    ssl: { rejectUnauthorized: true },
  });
});

test("Postgres pool config uses local development defaults", () => {
  expect(
    createPostgresPoolConfig({
      NODE_ENV: "development",
      USER: "tearleads_dev",
    }),
  ).toEqual({
    host: expectedDevHost(),
    port: 5432,
    user: "tearleads_dev",
    database: "tearleads_development",
    max: 15,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
});

test("Postgres pool config reads PG env overrides in development", () => {
  expect(
    createPostgresPoolConfig({
      NODE_ENV: "development",
      PGDATABASE: "pg_database",
      PGHOST: "127.0.0.1",
      PGPASSWORD: "pg_secret",
      PGPORT: "6543",
      PGUSER: "pg_user",
    }),
  ).toEqual({
    host: "127.0.0.1",
    port: 6543,
    user: "pg_user",
    password: "pg_secret",
    database: "pg_database",
    max: 15,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
});

test("Postgres pool config requires release env vars outside development", () => {
  expect(() =>
    createPostgresPoolConfig({
      NODE_ENV: "production",
      POSTGRES_HOST: "postgres.example.com",
    }),
  ).toThrow(
    "Missing required Postgres environment variables: POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DATABASE",
  );
});

test("Postgres pool config validates release port", () => {
  expect(() =>
    createPostgresPoolConfig({
      NODE_ENV: "production",
      POSTGRES_DATABASE: "tearleads",
      POSTGRES_HOST: "postgres.example.com",
      POSTGRES_PASSWORD: "secret",
      POSTGRES_PORT: "not-a-number",
      POSTGRES_USER: "api",
    }),
  ).toThrow("POSTGRES_PORT must be a valid number");

  expect(() =>
    createPostgresPoolConfig({
      NODE_ENV: "production",
      POSTGRES_DATABASE: "tearleads",
      POSTGRES_HOST: "postgres.example.com",
      POSTGRES_PASSWORD: "secret",
      POSTGRES_PORT: "5432.5",
      POSTGRES_USER: "api",
    }),
  ).toThrow("POSTGRES_PORT must be a valid number");

  expect(() =>
    createPostgresPoolConfig({
      NODE_ENV: "production",
      POSTGRES_DATABASE: "tearleads",
      POSTGRES_HOST: "postgres.example.com",
      POSTGRES_PASSWORD: "secret",
      POSTGRES_PORT: "65536",
      POSTGRES_USER: "api",
    }),
  ).toThrow("POSTGRES_PORT must be a valid number");
});

test("Postgres pool config supports SSL settings", () => {
  expect(
    createPostgresPoolConfig({
      NODE_ENV: "production",
      POSTGRES_DATABASE: "tearleads",
      POSTGRES_HOST: "postgres.example.com",
      POSTGRES_PASSWORD: "secret",
      POSTGRES_PORT: "5432",
      POSTGRES_SSL: "1",
      POSTGRES_SSL_REJECT_UNAUTHORIZED: "false",
      POSTGRES_USER: "api",
    }),
  ).toMatchObject({
    ssl: { rejectUnauthorized: false },
  });
});

test("default API database trims the adapter kind", async () => {
  const database: ManagedApiDatabase = createDefaultManagedApiDatabase({
    API_DATABASE: " pglite ",
  });

  expect(database.kind).toBe("memory");
  await database.close();
});
