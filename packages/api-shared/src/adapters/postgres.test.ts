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
}, 15_000);

test("default API database requires explicit production adapter", () => {
  expect(() =>
    createDefaultManagedApiDatabase({ NODE_ENV: "production" }),
  ).toThrow("API_DATABASE is required when NODE_ENV=production");
});

test("default API database requires a persistent SQLite path in production", () => {
  expect(() =>
    createDefaultManagedApiDatabase({
      API_DATABASE: "sqlite",
      NODE_ENV: "production",
    }),
  ).toThrow(
    "API_SQLITE_PATH or SQLITE_PATH is required when API_DATABASE=sqlite in production",
  );

  for (const sqlitePath of [
    ":memory:",
    "file:",
    "file:?cache=shared",
    "file::memory:?cache=shared",
    "file:ephemeral?mode=memory&cache=shared",
    "file:ephemeral?mo%64e=memory",
    "file:ephemeral?mode=memory#fragment",
    "file:ephemeral?mode=%6demor%79",
    "file:ephemeral?vfs=memdb",
    "file:%ZZ?mode=memory",
  ]) {
    expect(() =>
      createDefaultManagedApiDatabase({
        API_DATABASE: "sqlite",
        API_SQLITE_PATH: sqlitePath,
        NODE_ENV: "production",
      }),
    ).toThrow(
      "API_SQLITE_PATH or SQLITE_PATH must reference persistent storage in production",
    );
  }
});

test("default API database requires explicit Turso credentials", () => {
  expect(() =>
    createDefaultManagedApiDatabase({ API_DATABASE: "turso" }),
  ).toThrow("TURSO_DATABASE_URL is required when API_DATABASE=turso");
});

test("default API database supports sqlite migrations", async () => {
  const adapterUrl = new URL("./postgres.ts", import.meta.url).href;
  const schemaUrl = new URL("../schema.ts", import.meta.url).href;
  const script = `
    const {
      closeApiDatabase,
      db,
      getDefaultApiDatabaseKind,
      initializeApiDatabase,
    } = await import(${JSON.stringify(adapterUrl)});
    const { documents } = await import(${JSON.stringify(schemaUrl)});

    if (getDefaultApiDatabaseKind() !== "sqlite") {
      throw new Error("expected sqlite API database");
    }
    await initializeApiDatabase();
    const [inserted] = await db
      .insert(documents)
      .values({ createdByFingerprint: "sqlite-adapter-test" })
      .returning({ id: documents.id });
    if (!inserted?.id) {
      throw new Error("missing inserted document id");
    }
    const rows = await db
      .select({ id: documents.id })
      .from(documents);
    if (rows.length !== 1 || rows[0].id !== inserted.id) {
      throw new Error("sqlite document lookup failed");
    }
    await closeApiDatabase();
  `;
  const child = Bun.spawn({
    cmd: ["bun", "-e", script],
    env: {
      ...process.env,
      API_DATABASE: "sqlite",
      // Pin an isolated in-memory DB so an inherited API_SQLITE_PATH/SQLITE_PATH
      // can't make this open a persistent file and break the row-count assertion
      // on re-runs.
      API_SQLITE_PATH: ":memory:",
      SQLITE_PATH: ":memory:",
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ exitCode, stderr, stdout }).toMatchObject({ exitCode: 0 });
}, 15_000);

test("sqlite serializes direct writes against in-flight transactions", async () => {
  const adapterUrl = new URL("./postgres.ts", import.meta.url).href;
  // A direct db.execute() write issued while a top-level transaction is
  // suspended at its `await` must NOT be captured by that transaction's
  // begin/rollback on the shared SQLite connection. We start a transaction that
  // writes, awaits (yielding the event loop), then throws to force a rollback;
  // concurrently a direct write fires during the yield. The transaction's row
  // must be gone (rolled back) and the direct row must survive (committed).
  const script = `
    const { createDefaultManagedApiDatabase } = await import(${JSON.stringify(adapterUrl)});
    const { sql } = await import("drizzle-orm");
    const managed = createDefaultManagedApiDatabase({
      API_DATABASE: "sqlite",
      API_SQLITE_PATH: ":memory:",
      SQLITE_PATH: ":memory:",
    });
    const db = managed.db;
    await db.execute(sql\`create table t (id integer primary key, tag text)\`);

    let releaseDirect;
    const directGate = new Promise((resolve) => { releaseDirect = resolve; });

    const txPromise = db
      .transaction(async (tx) => {
        await tx.execute(sql\`insert into t (id, tag) values (1, 'tx')\`);
        // Let the concurrently-dispatched direct write get a chance to run
        // before this transaction rolls back.
        releaseDirect();
        await new Promise((resolve) => setTimeout(resolve, 25));
        throw new Error("force rollback");
      })
      .catch(() => "rolled-back");

    await directGate;
    const directPromise = db.execute(
      sql\`insert into t (id, tag) values (2, 'direct')\`,
    );

    await Promise.all([txPromise, directPromise]);

    const result = await db.execute(sql\`select id, tag from t order by id\`);
    const rows = result.rows;
    const tags = rows.map((row) => row.tag);
    if (tags.length !== 1 || tags[0] !== "direct") {
      throw new Error(
        "expected only the direct write to survive, got " + JSON.stringify(rows),
      );
    }
    await managed.close();
  `;
  const child = Bun.spawn({
    cmd: ["bun", "-e", script],
    env: {
      ...process.env,
      API_DATABASE: "sqlite",
      API_SQLITE_PATH: ":memory:",
      SQLITE_PATH: ":memory:",
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ exitCode, stderr, stdout }).toMatchObject({ exitCode: 0 });
}, 15_000);

test("sqlite serializes direct update().set() against in-flight transactions", async () => {
  const adapterUrl = new URL("./postgres.ts", import.meta.url).href;
  // Regression for the missing `set` factory hop: a direct
  // db.update(t).set(...) issued while a top-level transaction is suspended at
  // its `await` must NOT run inside that transaction's begin/rollback window on
  // the shared SQLite connection. The transaction writes row 2 then rolls back;
  // concurrently a direct update of the committed row 1 fires during the yield.
  // Row 2 must be gone and the row 1 update must survive as its own unit.
  const script = `
    const { createDefaultManagedApiDatabase } = await import(${JSON.stringify(adapterUrl)});
    const { sql, eq } = await import("drizzle-orm");
    const { sqliteTable, integer, text } = await import("drizzle-orm/sqlite-core");
    const t = sqliteTable("t", {
      id: integer("id").primaryKey(),
      tag: text("tag"),
    });
    const managed = createDefaultManagedApiDatabase({
      API_DATABASE: "sqlite",
      API_SQLITE_PATH: ":memory:",
      SQLITE_PATH: ":memory:",
    });
    const db = managed.db;
    await db.execute(sql\`create table t (id integer primary key, tag text)\`);
    await db.execute(sql\`insert into t (id, tag) values (1, 'base')\`);

    let releaseDirect;
    const directGate = new Promise((resolve) => { releaseDirect = resolve; });

    const txPromise = db
      .transaction(async (tx) => {
        await tx.execute(sql\`insert into t (id, tag) values (2, 'tx')\`);
        releaseDirect();
        await new Promise((resolve) => setTimeout(resolve, 25));
        throw new Error("force rollback");
      })
      .catch(() => "rolled-back");

    await directGate;
    const directPromise = db.update(t).set({ tag: "direct" }).where(eq(t.id, 1));

    await Promise.all([txPromise, directPromise]);

    const result = await db.execute(sql\`select id, tag from t order by id\`);
    const rows = result.rows;
    if (rows.length !== 1 || rows[0].id !== 1 || rows[0].tag !== "direct") {
      throw new Error(
        "expected only row 1 tagged 'direct' to survive, got " + JSON.stringify(rows),
      );
    }
    await managed.close();
  `;
  const child = Bun.spawn({
    cmd: ["bun", "-e", script],
    env: {
      ...process.env,
      API_DATABASE: "sqlite",
      API_SQLITE_PATH: ":memory:",
      SQLITE_PATH: ":memory:",
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ exitCode, stderr, stdout }).toMatchObject({ exitCode: 0 });
}, 15_000);
