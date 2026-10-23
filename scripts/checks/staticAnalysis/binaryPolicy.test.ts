import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture } from "./fixture.testUtils";

const root = resolve(import.meta.dir, "../../..");

test("binary checks inspect staged files and the PR base with a clean checkout", () => {
  const repo = fixture();
  try {
    repo.write(
      "agent-tool.json",
      readFileSync(join(root, "agent-tool.json"), "utf8"),
    );
    const base = repo.commit();
    repo.git("update-ref", "refs/remotes/origin/release", base);
    repo.write("payload.bin", "binary\u0000payload\n");
    repo.git("add", "payload.bin");
    const check = (...args: string[]) =>
      Bun.spawnSync(
        [
          process.execPath,
          join(root, "node_modules/.bin/agent-tool"),
          "checks",
          "binaries",
          ...args,
        ],
        {
          cwd: repo.cwd,
          env: { ...repo.env, GITHUB_BASE_REF: "release" },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
    expect(check("--staged").exitCode).toBe(1);
    repo.commit();
    expect(repo.git("status", "--porcelain")).toBe("");
    expect(check("--staged").exitCode).toBe(0);
    const result = check();
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout.toString()).rejected).toEqual([
      "payload.bin",
    ]);
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});
