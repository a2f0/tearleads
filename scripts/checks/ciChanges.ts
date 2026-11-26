import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { checkArguments, requireGitRoot } from "../lib/checkRoot";
import { type CiLockfiles, ciDiffRange, ciScopes } from "./ciPolicy";

const {
  CI_BASE_SHA: base,
  CI_HEAD_SHA: head,
  GITHUB_OUTPUT: output,
} = process.env;
if (!output) throw new Error("GITHUB_OUTPUT is required.");
const root = requireGitRoot(checkArguments().root);

// Undefined when Git cannot produce the output, which the policy treats as a
// change to every lane.
function git(args: string[]) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : undefined;
}

// The three-dot diff compares the head with the merge base, so the lockfile
// comparison does too.
function lockfiles(from: string, to: string): CiLockfiles {
  const mergeBase = git(["merge-base", from, to])?.trim();
  if (!mergeBase) return {};
  return {
    base: git(["show", `${mergeBase}:bun.lock`]),
    head: git(["show", `${to}:bun.lock`]),
  };
}

let scopes = { native: true, proofs: true, terraform: true };
const range = ciDiffRange(base, head);
if (range && base && head) {
  const paths = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", range, "--"],
    { cwd: root, encoding: "utf8" },
  ).split("\0");
  scopes = ciScopes(
    paths,
    paths.includes("bun.lock") ? lockfiles(base, head) : {},
  );
}
for (const [name, required] of Object.entries(scopes)) {
  appendFileSync(output, `${name}=${String(required)}\n`);
}
