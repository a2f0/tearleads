import { execFileSync, spawnSync } from "node:child_process";

export interface PrContext {
  readonly branch: string;
  readonly repo: string;
  readonly prNumber: string;
  readonly baseRef: string;
}

export function run(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
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

export function ensureChanges(baseRef: string): void {
  const result = spawnSync("git", ["diff", "--quiet", `${baseRef}...HEAD`], {
    stdio: "ignore",
  });
  if (result.status === 0) {
    throw new Error(`No changes found between ${baseRef} and current branch.`);
  }
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

  const baseRef = stringField(
    run("gh", ["pr", "view", prNumber, "--json", "baseRefName", "-R", repo]),
    "baseRefName",
  );
  if (baseRef.length === 0) {
    throw new Error("Could not determine base branch from GitHub.");
  }

  return { branch, repo, prNumber, baseRef };
}
