import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture } from "./fixture.testUtils";

const root = resolve(import.meta.dir, "../../..");

test("trust checks exclude accepted remote commits but reject new unsigned commits", () => {
  const repo = fixture();
  try {
    repo.write(
      "agent-tool.json",
      readFileSync(join(root, "agent-tool.json"), "utf8"),
    );
    const oldRemote = repo.commit();
    repo.git("remote", "add", "origin", "https://example.invalid/fixture.git");
    repo.git("update-ref", "refs/remotes/origin/chore/probe", oldRemote);
    repo.write("incoming.txt", "already accepted on main\n");
    const incoming = repo.commit();
    repo.git("update-ref", "refs/remotes/origin/main", incoming);
    const check = (...args: string[]) =>
      Bun.spawnSync(
        [
          process.execPath,
          join(root, "node_modules/.bin/agent-tool"),
          "commits",
          "check",
          ...args,
        ],
        { cwd: repo.cwd, env: repo.env, stdout: "pipe", stderr: "pipe" },
      );
    // The former remote..local range rechecks unsigned history already on main.
    expect(check("--range", `${oldRemote}..HEAD`).exitCode).toBe(1);
    expect(
      check(
        "--range",
        "HEAD",
        "--exclude",
        oldRemote,
        "--exclude-remotes",
        "origin",
      ).exitCode,
    ).toBe(0);
    repo.write("local.txt", "new unsigned commit must fail\n");
    repo.commit();
    expect(
      check(
        "--range",
        "HEAD",
        "--exclude",
        oldRemote,
        "--exclude-remotes",
        "origin",
      ).exitCode,
    ).toBe(1);
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});
