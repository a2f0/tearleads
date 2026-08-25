import { execFileSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { MAX_BUFFER_BYTES } from "../git/prContext";
import { materializeRawGitTree } from "./rawGitTree";

function git(rootDir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: MAX_BUFFER_BYTES,
  }).trim();
}

function makeTreeReadOnly(rootDir: string): void {
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      makeTreeReadOnly(entryPath);
    }
    const mode = lstatSync(entryPath).mode;
    chmodSync(entryPath, mode & ~0o222);
  }
  chmodSync(rootDir, lstatSync(rootDir).mode & ~0o222);
}

function makeDirectoriesWritable(rootDir: string): void {
  chmodSync(rootDir, lstatSync(rootDir).mode | 0o700);
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      makeDirectoriesWritable(path.join(rootDir, entry.name));
    }
  }
}

function removeSnapshot(tempRoot: string, repositoryRoot: string): void {
  try {
    makeDirectoriesWritable(repositoryRoot);
  } catch {
    // A partially-created snapshot may not contain its repository directory.
  }
  rmSync(tempRoot, { recursive: true, force: true });
}

/**
 * Run a callback against immutable raw blobs from the exact tracked `HEAD`.
 * Working-tree edits, untracked files, and `.git` metadata never enter it.
 */
export function withReviewSnapshot<T>(
  rootDir: string,
  callback: (repositoryRoot: string) => T,
): T {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "agent-tool-review-"));
  const repositoryRoot = path.join(tempRoot, "repository");
  mkdirSync(repositoryRoot);

  try {
    const head = git(rootDir, ["rev-parse", "--verify", "HEAD^{commit}"]);
    materializeRawGitTree(rootDir, head, repositoryRoot);
    makeTreeReadOnly(repositoryRoot);
    return callback(repositoryRoot);
  } finally {
    removeSnapshot(tempRoot, repositoryRoot);
  }
}
