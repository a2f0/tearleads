import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("archive fixtures cannot mutate the checkout exported by a Git hook", async () => {
  const canary = await mkdtemp(join(tmpdir(), "scope-hook-canary-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  try {
    execFileSync("git", ["-c", "init.templateDir=", "init", canary], {
      env,
      stdio: "pipe",
    });
    const config = join(canary, ".git/config");
    const before = await readFile(config, "utf8");
    const result = spawnSync(
      process.execPath,
      ["test", join(import.meta.dir, "archive.test.ts")],
      {
        env: {
          ...env,
          GIT_DIR: join(canary, ".git"),
          GIT_WORK_TREE: canary,
          GIT_INDEX_FILE: join(canary, ".git/index"),
        },
        encoding: "utf8",
        timeout: 30000,
      },
    );
    assert.equal(await readFile(config, "utf8"), before);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await Bun.file(join(canary, ".git/index")).exists(), false);
  } finally {
    await rm(canary, { recursive: true, force: true });
  }
});
