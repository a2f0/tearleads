import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { PrContext } from "../git/prContext";
import { withPinnedReviewInput } from "./pinnedReviewInput";

const repositories: string[] = [];

function git(rootDir: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
  }).trim();
}

function createRepository(): {
  rootDir: string;
  baseCommit: string;
  headCommit: string;
} {
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-tool-pinned-"));
  repositories.push(rootDir);
  git(rootDir, "init", "--quiet", "--initial-branch=main");
  git(rootDir, "config", "user.name", "Agent Tool Test");
  git(rootDir, "config", "user.email", "agent-tool@example.com");
  writeFileSync(path.join(rootDir, "AGENTS.md"), "TRUSTED POLICY\n");
  writeFileSync(path.join(rootDir, "tracked.txt"), "base\n");
  git(rootDir, "add", ".");
  git(rootDir, "commit", "--quiet", "-m", "test: base");
  const baseCommit = git(rootDir, "rev-parse", "HEAD");
  git(rootDir, "switch", "--quiet", "-c", "feature");
  writeFileSync(path.join(rootDir, "AGENTS.md"), "UNTRUSTED POLICY\n");
  writeFileSync(path.join(rootDir, "tracked.txt"), "reviewed\n");
  git(rootDir, "add", ".");
  git(rootDir, "commit", "--quiet", "-m", "test: reviewed");
  return {
    rootDir,
    baseCommit,
    headCommit: git(rootDir, "rev-parse", "HEAD"),
  };
}

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe("withPinnedReviewInput", () => {
  test("uses one base and head commit for policy, diff, and snapshot", () => {
    const { rootDir, baseCommit, headCommit } = createRepository();
    const context: PrContext = {
      branch: "feature",
      repo: "owner/repository",
      prNumber: "",
      title: "",
      baseRef: "main",
    };

    withPinnedReviewInput(rootDir, context, (input) => {
      expect(input.baseCommit).toBe(baseCommit);
      expect(input.headCommit).toBe(headCommit);
      expect(input.reviewInstructions).toBe("TRUSTED POLICY\n");
      expect(input.diff).toContain("+reviewed");
      expect(
        readFileSync(path.join(input.snapshotRoot, "tracked.txt"), "utf8"),
      ).toBe("reviewed\n");

      writeFileSync(path.join(rootDir, "tracked.txt"), "later\n");
      git(rootDir, "add", ".");
      git(rootDir, "commit", "--quiet", "-m", "test: later");
      expect(input.headCommit).toBe(headCommit);
      expect(
        readFileSync(path.join(input.snapshotRoot, "tracked.txt"), "utf8"),
      ).toBe("reviewed\n");
    });
  });

  test("ignores branch-selected textconv and external diff drivers", () => {
    const { rootDir } = createRepository();
    const textconvMarker = path.join(rootDir, "textconv-ran");
    const externalMarker = path.join(rootDir, "external-diff-ran");
    const textconvScript = path.join(rootDir, "textconv-driver.sh");
    const externalScript = path.join(rootDir, "external-diff-driver.sh");
    writeFileSync(
      textconvScript,
      `#!/bin/sh\ntouch ${JSON.stringify(textconvMarker)}\ncat "$1"\n`,
    );
    writeFileSync(
      externalScript,
      `#!/bin/sh\ntouch ${JSON.stringify(externalMarker)}\n`,
    );
    chmodSync(textconvScript, 0o755);
    chmodSync(externalScript, 0o755);
    git(rootDir, "config", "diff.hostile-textconv.textconv", textconvScript);
    git(rootDir, "config", "diff.hostile-external.command", externalScript);
    writeFileSync(
      path.join(rootDir, ".gitattributes"),
      [
        "tracked.txt diff=hostile-textconv",
        "AGENTS.md diff=hostile-external",
        "",
      ].join("\n"),
    );
    git(rootDir, "add", ".gitattributes");
    git(rootDir, "commit", "--quiet", "-m", "test: add hostile diff drivers");

    const context: PrContext = {
      branch: "feature",
      repo: "owner/repository",
      prNumber: "",
      title: "",
      baseRef: "main",
    };
    withPinnedReviewInput(rootDir, context, (input) => {
      expect(input.diff).toContain("+reviewed");
    });

    expect(existsSync(textconvMarker)).toBe(false);
    expect(existsSync(externalMarker)).toBe(false);
  });

  test("forces branch-selected binary paths into the review patch", () => {
    const { rootDir } = createRepository();
    writeFileSync(path.join(rootDir, ".gitattributes"), "tracked.txt -diff\n");
    git(rootDir, "add", ".gitattributes");
    git(rootDir, "commit", "--quiet", "-m", "test: hide tracked diff");

    const context: PrContext = {
      branch: "feature",
      repo: "owner/repository",
      prNumber: "",
      title: "",
      baseRef: "main",
    };
    withPinnedReviewInput(rootDir, context, (input) => {
      expect(input.diff).toContain("+reviewed");
      expect(input.diff).not.toContain("Binary files");
    });
  });
});
