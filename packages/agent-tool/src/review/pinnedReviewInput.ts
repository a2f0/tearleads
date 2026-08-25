import { execFileSync, spawnSync } from "node:child_process";

import { MAX_BUFFER_BYTES, type PrContext } from "../git/prContext";
import { readReviewInstructions } from "./reviewPrompt";
import { withReviewSnapshot } from "./reviewSnapshot";

interface PinnedReviewInput {
  readonly baseCommit: string;
  readonly headCommit: string;
  readonly diff: string;
  readonly reviewInstructions: string;
  readonly snapshotRoot: string;
}

const gitEnv = { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" };

function git(rootDir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootDir,
    env: gitEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: MAX_BUFFER_BYTES,
  }).trim();
}

function resolveCommit(rootDir: string, ref: string): string {
  return git(rootDir, ["rev-parse", "--verify", `${ref}^{commit}`]);
}

function ensureChanges(
  rootDir: string,
  baseCommit: string,
  headCommit: string,
): void {
  const range = `${baseCommit}...${headCommit}`;
  const result = spawnSync(
    "git",
    ["diff", "--quiet", "--text", "--no-textconv", "--no-ext-diff", range],
    {
      cwd: rootDir,
      env: gitEnv,
      stdio: "ignore",
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status === 0) {
    throw new Error(
      `No changes found between ${baseCommit} and ${headCommit}.`,
    );
  }
  if (result.status !== 1) {
    const detail =
      result.status === null ? "on a signal" : `code ${result.status}`;
    throw new Error(
      `Could not diff pinned review commits (git exited ${detail}).`,
    );
  }
}

/** Resolve refs once, then derive every review artifact from those commit IDs. */
export function withPinnedReviewInput<T>(
  rootDir: string,
  context: PrContext,
  callback: (input: PinnedReviewInput) => T,
): T {
  const baseCommit = resolveCommit(rootDir, context.baseRef);
  const headCommit = resolveCommit(rootDir, "HEAD");
  ensureChanges(rootDir, baseCommit, headCommit);

  const diff = git(rootDir, [
    "diff",
    "--text",
    "--no-textconv",
    "--no-ext-diff",
    `${baseCommit}...${headCommit}`,
  ]);
  const reviewInstructions = readReviewInstructions(rootDir, baseCommit);
  return withReviewSnapshot(rootDir, headCommit, (snapshotRoot) =>
    callback({
      baseCommit,
      headCommit,
      diff,
      reviewInstructions,
      snapshotRoot,
    }),
  );
}
