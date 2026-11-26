import { closeSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { appRoot, type Canary } from "./discover";
import { type CanaryOutput, parseCanaryOutput } from "./output";
import type { CanaryRun, CanaryRunStatus } from "./report";

/** A canary file takes under a minute; this stops one that hangs. */
const canaryTimeoutMs = 10 * 60_000;

const profileEnvironment = {
  DUAL_PANE_REQUEST_PROFILE: "1",
  DUAL_PANE_REQUEST_PROFILE_DETAIL: "1",
} as const;

export function runStatus(
  exitCode: number | null,
  timedOut: boolean,
  output: CanaryOutput,
): CanaryRunStatus {
  if (timedOut) return "timed-out";
  if (exitCode !== 0 || !output.tests || output.tests.fail > 0) return "failed";
  return output.phases.length === 0 ? "unprofiled" : "passed";
}

/**
 * Runs one canary file alone from `packages/app`, as its suite runs, with
 * the request profile on. Its output goes to `log`, owner-only.
 */
export async function runCanary(input: {
  readonly canary: Canary;
  readonly sample: number;
  readonly log: string;
  readonly root?: string;
}): Promise<CanaryRun> {
  const descriptor = openSync(input.log, "w", 0o600);
  const started = performance.now();
  let timedOut = false;
  let exitCode: number | null;
  try {
    const child = Bun.spawn(
      // A leading ./ makes Bun treat the argument as a path, not a filter.
      [process.execPath, "test", `./${input.canary.file}`],
      {
        cwd: input.root ?? appRoot,
        env: { ...process.env, ...profileEnvironment },
        stdin: "ignore",
        stdout: descriptor,
        stderr: descriptor,
      },
    );
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, canaryTimeoutMs);
    try {
      exitCode = await child.exited;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    closeSync(descriptor);
  }
  const wallMs = Math.round(performance.now() - started);
  const output = readCanaryOutput(await readFile(input.log, "utf8"));
  return {
    canary: input.canary.name,
    file: input.canary.file,
    sample: input.sample,
    status: output ? runStatus(exitCode, timedOut, output) : "failed",
    exitCode,
    wallMs,
    tests: output?.tests ?? null,
    log: input.log,
    phases: output?.phases ?? [],
  };
}

/**
 * The log's profile, or null when a metrics line is malformed: that run
 * fails, keeping its log, and the remaining canaries still run.
 */
function readCanaryOutput(log: string): CanaryOutput | null {
  try {
    return parseCanaryOutput(log);
  } catch {
    return null;
  }
}

/** The last lines of a failed run's log, for the terminal. */
export async function logTail(log: string, lines = 15): Promise<string> {
  const text = await readFile(log, "utf8");
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}
