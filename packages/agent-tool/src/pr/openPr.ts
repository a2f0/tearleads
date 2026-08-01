import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  findOpenPrNumber,
  resolveRepoContext,
  run,
  spawnExitCode,
} from "../git/prContext";
import { assertNoClaudeBranding } from "./assertNoClaudeBranding";
import { singleLineSubject } from "./subjectLine";
import { validateCommitSubject } from "./validateCommitSubject";

/** Read the PR body from stdin, or "" when stdin is a terminal/empty. */
function readBody(): string {
  // With no pipe/redirect, fd 0 is an open TTY and a blocking read would hang.
  if (process.stdin.isTTY) {
    return "";
  }
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Open a pull request for the current branch with a commitlint-conforming
 * title. The title defaults to the branch's latest commit subject, is validated
 * against the repo's commitlint rules (conventional-commit syntax and the
 * 50-char header limit) before the PR is created, and the body is read from
 * stdin. The base defaults to the repository's default branch.
 */
export function openPr(rootDir: string, titleArg: string | undefined): number {
  const { branch, repo, defaultBranch } = resolveRepoContext();

  const existing = findOpenPrNumber(branch, repo);
  if (existing.length > 0) {
    throw new Error(`An open PR already exists for '${branch}': #${existing}.`);
  }

  const tipSubject = run("git", ["log", "-1", "--format=%s"]);
  const title = singleLineSubject(titleArg, tipSubject, "PR title");
  validateCommitSubject(rootDir, title);

  const body = readBody();
  assertNoClaudeBranding(body);

  // Pin the base to the repo default branch; without --base, gh honors a
  // branch.<name>.gh-merge-base git config that could target another branch.
  const baseArgs = defaultBranch.length > 0 ? ["--base", defaultBranch] : [];
  const result = spawnSync(
    "gh",
    [
      "pr",
      "create",
      "--title",
      title,
      "--body",
      body,
      "--head",
      branch,
      ...baseArgs,
      "-R",
      repo,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  return spawnExitCode("gh pr create", result);
}
