import { spawnSync } from "node:child_process";

interface CurrentBranchPr {
  readonly baseRefName: string;
  readonly branch: string;
  readonly prNumber: string;
  readonly repo: string;
  readonly title: string;
}

interface CommandResult {
  readonly error?: Error;
  readonly signal: string | null;
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

type CommandRunner = (command: string, args: string[]) => CommandResult;

function runWithResult(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = {
    status: result.status,
    signal: result.signal,
    stderr: result.stderr,
    stdout: result.stdout,
  };
  return result.error ? { ...output, error: result.error } : output;
}

function field(source: string, key: string): unknown {
  try {
    const parsed: unknown = JSON.parse(source);
    return typeof parsed === "object" && parsed !== null
      ? Reflect.get(parsed, key)
      : undefined;
  } catch {
    return undefined;
  }
}

function stringField(source: string, key: string): string {
  const value = field(source, key);
  return typeof value === "string" ? value : "";
}

function numberField(source: string, key: string): string {
  const value = field(source, key);
  return typeof value === "number" ? String(value) : "";
}

export function repoFromPrUrl(prUrl: string): string {
  try {
    const segments = new URL(prUrl).pathname.split("/").filter(Boolean);
    if (segments.length >= 4 && segments[2] === "pull") {
      return `${segments[0]}/${segments[1]}`;
    }
  } catch {
    // Fall through to the actionable error below.
  }
  throw new Error(`Could not resolve the base repository from '${prUrl}'.`);
}

/** Resolve the current branch's open PR, including one from an upstream fork. */
export function viewCurrentBranchPr(
  branch: string,
  execute: CommandRunner = runWithResult,
): CurrentBranchPr | undefined {
  const result = execute("gh", [
    "pr",
    "view",
    "--json",
    "number,state,title,url,baseRefName",
  ]);
  if (result.error) {
    throw new Error(`Could not run gh pr view: ${result.error.message}`);
  }
  if (result.signal !== null) {
    throw new Error(`gh pr view terminated by signal ${result.signal}.`);
  }
  if (result.status !== 0) {
    const failure = result.stderr.trim();
    if (failure === `no pull requests found for branch "${branch}"`) {
      return undefined;
    }
    throw new Error(
      `Could not resolve the current branch's PR: ${failure || "gh pr view failed"}`,
    );
  }
  const state = stringField(result.stdout, "state");
  if (state === "CLOSED" || state === "MERGED") {
    return undefined;
  }
  if (state !== "OPEN") {
    throw new Error(`Current branch PR has invalid state '${state}'.`);
  }

  const prNumber = numberField(result.stdout, "number");
  const prUrl = stringField(result.stdout, "url");
  if (prNumber.length === 0 || prUrl.length === 0) {
    throw new Error("Could not determine the current branch's PR identity.");
  }
  return {
    branch,
    repo: repoFromPrUrl(prUrl),
    prNumber,
    title: stringField(result.stdout, "title"),
    baseRefName: stringField(result.stdout, "baseRefName"),
  };
}
