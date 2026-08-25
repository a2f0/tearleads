import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { withReviewSnapshot } from "./reviewSnapshot";

const repositories: string[] = [];

function git(rootDir: string, args: string[]): void {
  execFileSync("git", args, { cwd: rootDir, stdio: "ignore" });
}

function createRepository(): string {
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-tool-source-"));
  repositories.push(rootDir);
  git(rootDir, ["init", "--quiet"]);
  git(rootDir, ["config", "user.email", "agent-tool@example.com"]);
  git(rootDir, ["config", "user.name", "Agent Tool"]);
  mkdirSync(path.join(rootDir, "src"));
  writeFileSync(path.join(rootDir, "src", "tracked.txt"), "committed\n");
  git(rootDir, ["add", "."]);
  git(rootDir, ["commit", "--quiet", "-m", "test: seed repository"]);
  return rootDir;
}

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe("withReviewSnapshot", () => {
  test("exports only the immutable tracked HEAD", () => {
    const rootDir = createRepository();
    writeFileSync(path.join(rootDir, "src", "tracked.txt"), "working tree\n");
    writeFileSync(path.join(rootDir, "untracked-secret.txt"), "secret\n");

    let snapshotRoot = "";
    withReviewSnapshot(rootDir, (repositoryRoot) => {
      snapshotRoot = repositoryRoot;
      const trackedPath = path.join(repositoryRoot, "src", "tracked.txt");

      expect(readFileSync(trackedPath, "utf8")).toBe("committed\n");
      expect(
        existsSync(path.join(repositoryRoot, "untracked-secret.txt")),
      ).toBe(false);
      expect(existsSync(path.join(repositoryRoot, ".git"))).toBe(false);
      expect(statSync(trackedPath).mode & 0o222).toBe(0);
      expect(statSync(repositoryRoot).mode & 0o222).toBe(0);
    });

    expect(existsSync(snapshotRoot)).toBe(false);
  });

  test("removes the snapshot when the review throws", () => {
    const rootDir = createRepository();
    let snapshotRoot = "";

    expect(() =>
      withReviewSnapshot(rootDir, (repositoryRoot) => {
        snapshotRoot = repositoryRoot;
        throw new Error("review failed");
      }),
    ).toThrow("review failed");
    expect(existsSync(snapshotRoot)).toBe(false);
  });
});
