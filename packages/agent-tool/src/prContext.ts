import { execFileSync, spawnSync } from "node:child_process";

export interface PrContext {
  readonly branch: string;
  readonly repo: string;
  readonly prNumber: string;
  readonly baseRef: string;
}

interface ReviewProcessResult {
  readonly status: number | null;
  readonly signal: string | null;
  readonly error?: Error;
}

// Large diffs blow past execFileSync's default 1 MiB maxBuffer and throw
// ENOBUFS before we can hand the diff to a reviewer, so capture generously.
const MAX_BUFFER_BYTES = 512 * 1024 * 1024;

export function run(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: MAX_BUFFER_BYTES,
  }).trim();
}

function tryRun(command: string, args: string[]): string | null {
  try {
    return run(command, args);
  } catch {
    return null;
  }
}

function safeParse(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

function stringField(source: string | null, key: string): string {
  if (source === null) {
    return "";
  }
  const value = fieldOf(safeParse(source), key);
  return typeof value === "string" ? value : "";
}

function firstPrNumber(source: string | null): string {
  if (source === null) {
    return "";
  }
  const parsed = safeParse(source);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return "";
  }
  const numberField = fieldOf(parsed[0], "number");
  return typeof numberField === "number" ? String(numberField) : "";
}

function gitRefExists(ref: string): boolean {
  if (ref.length === 0) {
    return false;
  }
  const result = spawnSync(
    "git",
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    { stdio: "ignore" },
  );
  return result.status === 0;
}

/**
 * Resolve the PR base branch to a ref that exists locally. GitHub returns a
 * bare branch name (e.g. `main`), which `git diff` cannot resolve when the
 * branch only exists as a remote-tracking ref. Prefer a local ref, then the
 * remote-tracking ref, then the base commit SHA, fetching from origin if none
 * are present locally.
 */
function resolveBaseRef(baseRefName: string, baseRefOid: string): string {
  for (const candidate of [baseRefName, `origin/${baseRefName}`, baseRefOid]) {
    if (gitRefExists(candidate)) {
      return candidate;
    }
  }

  spawnSync("git", ["fetch", "--quiet", "origin", baseRefName], {
    stdio: "ignore",
  });
  if (gitRefExists(`origin/${baseRefName}`)) {
    return `origin/${baseRefName}`;
  }
  if (gitRefExists(baseRefOid)) {
    return baseRefOid;
  }

  throw new Error(
    `Could not resolve base ref '${baseRefName}' locally. Fetch it and retry.`,
  );
}

export function ensureChanges(baseRef: string): void {
  const result = spawnSync("git", ["diff", "--quiet", `${baseRef}...HEAD`], {
    stdio: "ignore",
  });
  if (result.error) {
    throw result.error;
  }
  // `git diff --quiet` exits 0 (no changes), 1 (changes), or >1 on error.
  if (result.status === 0) {
    throw new Error(`No changes found between ${baseRef} and current branch.`);
  }
  if (result.status !== 1) {
    const detail =
      result.status === null ? "on a signal" : `code ${result.status}`;
    throw new Error(
      `Could not diff against base ref '${baseRef}' (git exited ${detail}).`,
    );
  }
}

/**
 * Map a spawnSync result to a process exit code. A failure to launch (missing
 * binary) or a signal termination leaves `status` null; treat those as a
 * nonzero exit so callers can fall back to another reviewer.
 */
export function reviewExitCode(
  command: string,
  result: ReviewProcessResult,
): number {
  if (result.error) {
    process.stderr.write(`Failed to run ${command}: ${result.error.message}\n`);
    return 1;
  }
  if (result.signal !== null) {
    process.stderr.write(`${command} terminated by signal ${result.signal}\n`);
    return 1;
  }
  return result.status ?? 1;
}

/**
 * Resolve the open PR for the current branch from git + GitHub. Throws with an
 * actionable message when there is nothing reviewable (on main, no PR, gh not
 * authenticated).
 */
export function resolvePrContext(): PrContext {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main") {
    throw new Error("Cannot review main branch. Checkout a PR branch first.");
  }

  const repo = stringField(
    tryRun("gh", ["repo", "view", "--json", "nameWithOwner"]),
    "nameWithOwner",
  );
  if (repo.length === 0) {
    throw new Error(
      "Could not determine repository. Ensure gh is authenticated.",
    );
  }

  const prNumber = firstPrNumber(
    tryRun("gh", [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number",
      "-R",
      repo,
    ]),
  );
  if (prNumber.length === 0) {
    throw new Error(`No PR found for branch '${branch}'. Create a PR first.`);
  }

  const baseInfo = run("gh", [
    "pr",
    "view",
    prNumber,
    "--json",
    "baseRefName,baseRefOid",
    "-R",
    repo,
  ]);
  const baseRefName = stringField(baseInfo, "baseRefName");
  if (baseRefName.length === 0) {
    throw new Error("Could not determine base branch from GitHub.");
  }
  const baseRef = resolveBaseRef(
    baseRefName,
    stringField(baseInfo, "baseRefOid"),
  );

  return { branch, repo, prNumber, baseRef };
}
