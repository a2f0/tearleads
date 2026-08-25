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

  test("ignores branch-controlled export attributes and content filters", () => {
    const rootDir = createRepository();
    writeFileSync(
      path.join(rootDir, ".gitattributes"),
      [
        "hidden.txt export-ignore",
        "subst.txt export-subst",
        "filtered.txt filter=review-snapshot-test",
        "",
      ].join("\n"),
    );
    writeFileSync(path.join(rootDir, "hidden.txt"), "still visible\n");
    writeFileSync(path.join(rootDir, "subst.txt"), "$Format:%H$\n");
    writeFileSync(path.join(rootDir, "filtered.txt"), "raw\n");
    git(rootDir, [
      "config",
      "filter.review-snapshot-test.smudge",
      "sed s/raw/smudged/",
    ]);
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "--quiet", "-m", "test: add hostile attributes"]);

    withReviewSnapshot(rootDir, (repositoryRoot) => {
      expect(
        readFileSync(path.join(repositoryRoot, "hidden.txt"), "utf8"),
      ).toBe("still visible\n");
      expect(readFileSync(path.join(repositoryRoot, "subst.txt"), "utf8")).toBe(
        "$Format:%H$\n",
      );
      expect(
        readFileSync(path.join(repositoryRoot, "filtered.txt"), "utf8"),
      ).toBe("raw\n");
    });
  });

  test("reads the committed blobs rather than local replacement refs", () => {
    const rootDir = createRepository();
    const originalBlob = execFileSync(
      "git",
      ["rev-parse", "HEAD:src/tracked.txt"],
      { cwd: rootDir, encoding: "utf8" },
    ).trim();
    const replacementBlob = execFileSync(
      "git",
      ["hash-object", "-w", "--stdin"],
      {
        cwd: rootDir,
        encoding: "utf8",
        input: "locally replaced\n",
      },
    ).trim();
    git(rootDir, ["replace", originalBlob, replacementBlob]);

    withReviewSnapshot(rootDir, (repositoryRoot) => {
      expect(
        readFileSync(path.join(repositoryRoot, "src", "tracked.txt"), "utf8"),
      ).toBe("committed\n");
    });
  });
});
