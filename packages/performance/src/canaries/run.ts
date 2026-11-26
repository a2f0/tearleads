import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseCapture, summarizeCapture } from "../statements/summary";
import {
  packagePreloads,
  runTestProcess,
  testFileArgument,
} from "../testProcess";
import { appRoot, type Canary } from "./discover";
import { type CanaryOutput, parseCanaryOutput } from "./output";
import type { CanaryRun, CanaryRunStatus } from "./report";

/** A canary file takes under a minute; this stops one that hangs. */
const canaryTimeoutMs = 10 * 60_000;

const capturePreload = resolve(
  import.meta.dir,
  "../statements/capturePreload.ts",
);

const profileEnvironment = {
  DUAL_PANE_REQUEST_PROFILE: "1",
  DUAL_PANE_REQUEST_PROFILE_DETAIL: "1",
} as const;

/** Record the API's statements beside the request profile. */
export interface CanaryCapture {
  readonly out: string;
  readonly paramHash: boolean;
}

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
 * Statements per profiled phase, from the capture's phase markers. The
 * markers come from the same metrics lines, so they pair in order; null when
 * they do not, as when the capture stopped at its limit.
 */
export function phaseStatements(
  output: CanaryOutput,
  capture: string,
): number[] | null {
  const phases = summarizeCapture(parseCapture(capture), 0).phases;
  if (
    phases.length !== output.phases.length ||
    phases.some((phase, index) => phase.label !== output.phases[index]?.label)
  )
    return null;
  return phases.map((phase) => phase.statements);
}

/**
 * Runs one canary file alone from `packages/app`, as its suite runs, with
 * the request profile on and, when asked, the statement capture. Its output
 * goes to `log`, owner-only.
 */
export async function runCanary(input: {
  readonly canary: Canary;
  readonly sample: number;
  readonly log: string;
  readonly capture?: CanaryCapture;
  readonly root?: string;
}): Promise<CanaryRun> {
  const root = input.root ?? appRoot;
  const { capture } = input;
  const preloads = capture
    ? [...(await packagePreloads(root)), capturePreload]
    : [];
  const result = await runTestProcess({
    cwd: root,
    args: [
      ...preloads.flatMap((preload) => ["--preload", preload]),
      testFileArgument(input.canary.file),
    ],
    env: {
      ...process.env,
      ...profileEnvironment,
      ...(capture && {
        PERF_STATEMENTS_OUT: capture.out,
        PERF_STATEMENTS_PARAM_HASH: capture.paramHash ? "1" : "0",
      }),
    },
    log: input.log,
    timeoutMs: canaryTimeoutMs,
  });
  const output = readCanaryOutput(await readFile(input.log, "utf8"));
  const status = output
    ? runStatus(result.exitCode, result.timedOut, output)
    : "failed";
  return {
    canary: input.canary.name,
    file: input.canary.file,
    sample: input.sample,
    status,
    exitCode: result.exitCode,
    wallMs: result.wallMs,
    tests: output?.tests ?? null,
    log: input.log,
    phases: output?.phases ?? [],
    statements:
      output && capture && status === "passed"
        ? {
            capture: capture.out,
            perPhase: phaseStatements(
              output,
              await readFile(capture.out, "utf8"),
            ),
          }
        : null,
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
