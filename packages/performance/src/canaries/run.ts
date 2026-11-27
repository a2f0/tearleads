import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readCaptureFile } from "../statements/captureFile";
import {
  parseClientSqlCapture,
  summarizeClientSqlCapture,
} from "../statements/clientSqlSummary";
import { parseCapture, summarizeCapture } from "../statements/summary";
import {
  packagePreloads,
  runTestProcess,
  testFileArgument,
} from "../testProcess";
import { appRoot, type Canary } from "./discover";
import { type CanaryOutput, parseCanaryOutput } from "./output";
import {
  parsePayloadAudit,
  summarizePayloadAudit,
} from "./payloadAuditSummary";
import type {
  CanaryRun,
  CanaryRunStatus,
  RunClientSql,
  RunPayloadAudit,
} from "./report";
import type { RunStatements } from "./runStatements";

/** A canary file takes under a minute; this stops one that hangs. */
const canaryTimeoutMs = 10 * 60_000;

const capturePreload = resolve(
  import.meta.dir,
  "../statements/capturePreload.ts",
);
const clientSqlPreload = resolve(
  import.meta.dir,
  "../statements/clientSqlPreload.ts",
);
const payloadAuditPreload = resolve(
  import.meta.dir,
  "./payloadAuditPreload.ts",
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

/** Record sanitized per-pane field bytes, echoes, redeliveries, and head re-reads. */
export interface CanaryPayloadAudit {
  readonly out: string;
  readonly stacks: boolean;
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

export interface CanaryRunInput {
  readonly canary: Canary;
  readonly sample: number;
  readonly log: string;
  readonly capture?: CanaryCapture;
  readonly clientSql?: { readonly out: string };
  readonly payloadAudit?: CanaryPayloadAudit;
  /** The app package to run in; `packages/app` unless a test passes one. */
  readonly root?: string;
}

async function buildCanaryPreloads(
  root: string,
  input: Pick<CanaryRunInput, "capture" | "clientSql" | "payloadAudit">,
): Promise<string[]> {
  const extra = [
    ...(input.capture ? [capturePreload] : []),
    ...(input.clientSql ? [clientSqlPreload] : []),
    ...(input.payloadAudit ? [payloadAuditPreload] : []),
  ];
  return extra.length > 0 ? [...(await packagePreloads(root)), ...extra] : [];
}

function buildCanaryEnv(
  input: Pick<CanaryRunInput, "capture" | "clientSql" | "payloadAudit">,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...profileEnvironment,
    ...(input.capture && {
      PERF_STATEMENTS_OUT: input.capture.out,
      PERF_STATEMENTS_PARAM_HASH: input.capture.paramHash ? "1" : "0",
    }),
    ...(input.clientSql && {
      PERF_CLIENT_SQL_OUT: input.clientSql.out,
    }),
    ...(input.payloadAudit && {
      PERF_PAYLOAD_AUDIT_OUT: input.payloadAudit.out,
      PERF_PAYLOAD_AUDIT_STACKS: input.payloadAudit.stacks ? "1" : "0",
    }),
  };
}

/**
 * Runs one canary file alone from `packages/app`, as its suite runs, with
 * the request profile on and, when asked, the statement and payload captures.
 * Its output goes to `log`, owner-only.
 */
export async function runCanary(input: CanaryRunInput): Promise<CanaryRun> {
  const root = input.root ?? appRoot;
  const { capture, clientSql, payloadAudit } = input;
  const preloads = await buildCanaryPreloads(root, input);
  const result = await runTestProcess({
    cwd: root,
    args: [
      ...preloads.flatMap((preload) => ["--preload", preload]),
      testFileArgument(input.canary.file),
    ],
    env: buildCanaryEnv(input),
    log: input.log,
    timeoutMs: canaryTimeoutMs,
  });
  const output = readCanaryOutput(await readFile(input.log, "utf8"));
  const status = output
    ? runStatus(result.exitCode, result.timedOut, output)
    : "failed";
  const passedOutput = output && status === "passed" ? output : null;
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
      passedOutput && capture
        ? await capturedStatements(passedOutput, capture.out)
        : { status: "off" },
    ...(clientSql && {
      clientSql: passedOutput
        ? await capturedClientSql(clientSql.out)
        : { status: "off" },
    }),
    ...(payloadAudit && {
      payloadAudit: passedOutput
        ? await capturedPayloadAudit(payloadAudit.out)
        : { status: "off" },
    }),
  };
}

async function capturedClientSql(capture: string): Promise<RunClientSql> {
  const text = await readCaptureFile(capture).catch(() => null);
  if (text === null) return { status: "missing", capture };
  try {
    return {
      status: "captured",
      capture,
      summary: summarizeClientSqlCapture(parseClientSqlCapture(text)),
    };
  } catch {
    return { status: "missing", capture };
  }
}

async function capturedPayloadAudit(capture: string): Promise<RunPayloadAudit> {
  const text = await readCaptureFile(capture).catch(() => null);
  if (text === null) return { status: "missing", capture };
  try {
    return {
      status: "captured",
      capture,
      summary: summarizePayloadAudit(parsePayloadAudit(text)),
    };
  } catch {
    return { status: "missing", capture };
  }
}

/**
 * Statements per phase, or `unmatched` when the capture cannot be matched to
 * the profile: its markers differ, it was never written, or it cannot be
 * read or parsed. The run keeps its result, and the report names the capture.
 */
async function capturedStatements(
  output: CanaryOutput,
  capture: string,
): Promise<RunStatements> {
  const perPhase = await readCaptureFile(capture)
    .then((text) => phaseStatements(output, text ?? ""))
    .catch(() => null);
  return perPhase === null
    ? { status: "unmatched", capture }
    : { status: "captured", capture, perPhase };
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
