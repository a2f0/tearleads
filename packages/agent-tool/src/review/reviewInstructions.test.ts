import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readReviewInstructions } from "./reviewPrompt";

const repoDir = mkdtempSync(path.join(tmpdir(), "agent-tool-policy-"));

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
  }).trim();
}

git("init", "--quiet", "--initial-branch=main");
git("config", "user.name", "Agent Tool Test");
git("config", "user.email", "agent-tool@example.com");
writeFileSync(path.join(repoDir, "AGENTS.md"), "TRUSTED BASE POLICY\n");
git("add", "AGENTS.md");
git("commit", "--quiet", "-m", "base policy");
const baseCommit = git("rev-parse", "HEAD");

writeFileSync(path.join(repoDir, "AGENTS.md"), "BRANCH POLICY\n");
writeFileSync(path.join(repoDir, "REVIEW.md"), "BRANCH OVERRIDE\n");
git("add", "AGENTS.md", "REVIEW.md");
git("commit", "--quiet", "-m", "branch policy");

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("readReviewInstructions", () => {
  test("reads policy from the base commit, not the reviewed branch", () => {
    expect(readReviewInstructions(repoDir, baseCommit)).toBe(
      "TRUSTED BASE POLICY\n",
    );
  });
});
