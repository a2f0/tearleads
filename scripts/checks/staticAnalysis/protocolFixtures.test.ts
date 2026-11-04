import { expect, test } from "bun:test";
import { cpSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture } from "./fixture.testUtils";

test("TLA+ locks include integrity for every recorded platform", () => {
  const lock = Bun.TOML.parse(
    readFileSync(resolve(import.meta.dir, "../../../mise.lock"), "utf8"),
  ) as {
    tools: Record<string, { version: string; [key: string]: unknown }[]>;
  };
  const tools = lock.tools["github:tlaplus/tlaplus"];
  expect(tools).toHaveLength(1);
  for (const tool of tools ?? []) {
    const platforms = Object.entries(tool).filter(([key]) =>
      key.startsWith("platforms."),
    );
    expect(platforms.length).toBeGreaterThan(0);
    for (const [platform, value] of platforms) {
      const artifact = value as { checksum?: string; url?: string };
      expect(artifact.checksum, platform).toMatch(
        /^(sha256|blake3):[a-f0-9]{64}$/,
      );
      expect(artifact.url, platform).toBe(
        `https://github.com/tlaplus/tlaplus/releases/download/v${tool.version}/tla2tools.jar`,
      );
    }
  }
});

test("protocol fixtures leave a linked hook's repository untouched", () => {
  const repo = fixture();
  try {
    const source = resolve(import.meta.dir, "../../..");
    for (const path of [
      ".mise.toml",
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
}, 45_000);
