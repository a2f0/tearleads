import { expect, test } from "bun:test";
import { cpSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture } from "./fixture.testUtils";

test("protocol fixtures leave a linked hook's repository untouched", () => {
  const repo = fixture();
  try {
    const source = resolve(import.meta.dir, "../../..");
    for (const path of [
      "scripts/checks/checkProtocolModels.sh",
      "scripts/checks/testProtocolModels.sh",
      "scripts/checks/tlaToolsPin.sh",
      "scripts/checks/fixtures/protocolModels",
    ]) {
      cpSync(join(source, path), join(repo.cwd, path), { recursive: true });
    }
    const head = repo.commit();
    const linked = join(repo.cwd, "linked");
    repo.git("worktree", "add", "--detach", linked);
    const gitDir = repo.git("-C", linked, "rev-parse", "--absolute-git-dir");
    const config = readFileSync(join(repo.cwd, ".git/config"), "utf8");
    const result = Bun.spawnSync(
      ["sh", "scripts/checks/testProtocolModels.sh"],
      {
        cwd: linked,
        env: { ...repo.env, GIT_DIR: gitDir },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(readFileSync(join(repo.cwd, ".git/config"), "utf8")).toBe(config);
    expect(repo.git("rev-parse", "HEAD")).toBe(head);
    expect(repo.git("rev-parse", "--is-bare-repository")).toBe("false");
    expect(repo.git("-C", linked, "status", "--porcelain")).toBe("");
    expect(result.stderr.toString()).not.toContain("re-init");
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
}, 15_000);
