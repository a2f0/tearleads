import { expect, test } from "bun:test";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

// drizzle-kit compares the schema with the newest snapshot in the journal and
// writes a new migration when they differ. Run it on a copy: a schema edit
// without its generated migration fails here instead of in production.
test("the Drizzle schema matches the newest migration snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tearleads-migration-drift-"));
  try {
    const folder = join(directory, "drizzle");
    await cp(join(packageDirectory, "drizzle"), folder, { recursive: true });
    const before = await readdir(folder, { recursive: true });
    const generate = Bun.spawnSync(
      [
        process.execPath,
        join(packageDirectory, "node_modules/drizzle-kit/bin.cjs"),
        "generate",
        "--dialect",
        "postgresql",
        "--schema",
        "./src/schema.ts",
        // drizzle-kit prefixes `--out` with "./", so it must be relative.
        "--out",
        relative(packageDirectory, folder),
      ],
      { cwd: packageDirectory },
    );
    const output = `${generate.stdout.toString()}${generate.stderr.toString()}`;
    expect(generate.exitCode).toBe(0);
    const added = (await readdir(folder, { recursive: true })).filter(
      (path) => !before.includes(path),
    );
    if (added.length > 0) {
      throw new Error(
        `src/schema changed without a migration (drizzle-kit wrote ${added.join(", ")}). Run \`bun run db:generate --name <change>\` in packages/api-shared and commit the result.`,
      );
    }
    expect(output).toContain("No schema changes");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
