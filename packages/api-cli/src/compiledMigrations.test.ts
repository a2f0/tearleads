import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SQL } from "bun";

// The executable cannot load PGlite's assets, so it migrates a real server: the
// Postgres concurrency lane supplies DATABASE_URL, and this test creates and
// drops its own database there.
const { DATABASE_URL: serverUrl } = process.env;
const { entries: journalEntries }: { entries: unknown[] } = JSON.parse(
  readFileSync(
    new URL("../../api-shared/drizzle/meta/_journal.json", import.meta.url),
    "utf8",
  ),
);

async function tableNames(databaseUrl: string): Promise<string[]> {
  const client = new SQL(databaseUrl);
  try {
    const rows: { tablename: string }[] =
      await client`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    const journal: unknown[] =
      await client`SELECT id FROM drizzle.__drizzle_migrations`;
    expect(journal).toHaveLength(journalEntries.length);
    return rows.map(({ tablename }) => tablename);
  } finally {
    await client.close();
  }
}

// Run from outside the checkout, the executable can only find the migrations
// it embedded: the source tree's default migration folder does not exist there.
test.skipIf(!serverUrl)(
  "the standalone CLI applies its embedded migrations outside the checkout",
  async () => {
    if (!serverUrl) throw new Error("DATABASE_URL is required");
    const directory = await mkdtemp(
      join(tmpdir(), "tearleads-compiled-schema-"),
    );
    const databaseName = `tearleads_compiled_cli_${randomUUID().replaceAll("-", "")}`;
    const databaseUrl = new URL(serverUrl);
    databaseUrl.pathname = `/${databaseName}`;
    const admin = new SQL(serverUrl);
    try {
      await admin.unsafe(`CREATE DATABASE ${databaseName}`);
      const executable = join(directory, "tearleads-api-cli");
      const build = Bun.spawnSync(
        [process.execPath, "scripts/buildApiCliExecutable.ts"],
        {
          cwd: fileURLToPath(new URL("..", import.meta.url)),
          env: {
            ...process.env,
            BUN_COMPILE_TARGET: `bun-${process.platform}-${process.arch}`,
            BUN_COMPILE_OUTFILE: executable,
          },
        },
      );
      expect(build.stderr.toString()).toBe("");
      expect(build.exitCode).toBe(0);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const migration = Bun.spawnSync([executable, "migrate"], {
          cwd: directory,
          env: {
            ...process.env,
            NODE_ENV: "production",
            API_DATABASE: "postgres",
            DATABASE_URL: databaseUrl.href,
          },
        });
        expect(migration.stderr.toString()).toBe("");
        expect(migration.exitCode).toBe(0);
      }
      const tables = await tableNames(databaseUrl.href);
      expect(tables).toHaveLength(50);
      expect(tables).toEqual(
        expect.arrayContaining([
          "principal_directory_bindings",
          "principal_policy_commits",
        ]),
      );
    } finally {
      await admin.unsafe(
        `DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`,
      );
      await admin.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  60_000,
);
