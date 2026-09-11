import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("the standalone CLI initializes its embedded baseline outside the checkout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tearleads-compiled-schema-"));
  try {
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
    const databasePath = join(directory, "database.sqlite");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const migration = Bun.spawnSync([executable, "migrate"], {
        cwd: directory,
        env: {
          ...process.env,
          NODE_ENV: "production",
          API_DATABASE: "sqlite",
          API_SQLITE_PATH: databasePath,
        },
      });
      expect(migration.stderr.toString()).toBe("");
      expect(migration.exitCode).toBe(0);
    }
    const database = new Database(databasePath, { readonly: true });
    try {
      const tables = database
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'",
        )
        .all();
      expect(tables).toHaveLength(55);
      expect(
        database.query("SELECT id FROM __drizzle_migrations").all(),
      ).toHaveLength(1);
    } finally {
      database.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
