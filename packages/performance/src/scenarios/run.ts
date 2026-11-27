import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { TestCounts } from "../canaries/output";
import {
  parsePayloadAudit,
  summarizePayloadAudit,
} from "../canaries/payloadAuditSummary";
import type { RunClientSql, RunPayloadAudit } from "../canaries/report";
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
import { bobAndAliceRoot, type Scenario } from "./discover";
import {
  parseScenarioHttpCapture,
  type ScenarioHttpSummary,
  summarizeScenarioHttp,
} from "./httpCapture";
import type {
  RunScenarioStatements,
  ScenarioRun,
  ScenarioRunStatus,
} from "./report";

/** Large scenarios like `stagedBaseline` or `manyRotations` can take several minutes. */
const scenarioTimeoutMs = 15 * 60_000;

const scenarioHttpPreload = resolve(import.meta.dir, "scenarioHttpPreload.ts");
const capturePreload = resolve(
  import.meta.dir,
  "../statements/capturePreload.ts",
);
const clientSqlPreload = resolve(
  import.meta.dir,
  "../statements/clientSqlPreload.ts",
);

export interface ScenarioRunInput {
  readonly scenario: Scenario;
  readonly sample: number;
  readonly log: string;
  readonly httpCapture: string;
  readonly statements?: {
    readonly out: string;
    readonly paramHash: boolean;
  };
  readonly clientSql?: { readonly out: string };
  readonly payloadAudit?: {
    readonly out: string;
    readonly stacks: boolean;
  };
  /** The bob-and-alice package root; defaults to `packages/bob-and-alice`. */
  readonly root?: string;
}

function parseTestCount(text: string, outcome: "pass" | "fail"): number | null {
  const matches = [
    ...text.matchAll(new RegExp(`^ *(\\d+) ${outcome}$`, "gmu")),
  ];
  const last = matches.at(-1)?.[1];
  return last === undefined ? null : Number(last);
}

export function parseBunTestCounts(log: string): TestCounts | null {
  const pass = parseTestCount(log, "pass");
  const fail = parseTestCount(log, "fail");
  return pass === null || fail === null ? null : { pass, fail };
}

export function scenarioRunStatus(
  exitCode: number | null,
  timedOut: boolean,
  tests: TestCounts | null,
  http: ScenarioHttpSummary | null,
): ScenarioRunStatus {
  if (timedOut) return "timed-out";
  if (exitCode !== 0 || !tests || tests.fail > 0) return "failed";
  return http === null || http.requests === 0 ? "unprofiled" : "passed";
}

async function readHttpSummary(
  capturePath: string,
): Promise<ScenarioHttpSummary | null> {
  const text = await readCaptureFile(capturePath).catch(() => null);
  if (text === null) return null;
  try {
    return summarizeScenarioHttp(parseScenarioHttpCapture(text));
  } catch {
    return null;
  }
}

async function readApiStatements(
  capturePath: string,
): Promise<RunScenarioStatements> {
  const text = await readCaptureFile(capturePath).catch(() => null);
  if (text === null) return { status: "missing", capture: capturePath };
  try {
    return {
      status: "captured",
      capture: capturePath,
      summary: summarizeCapture(parseCapture(text)),
    };
  } catch {
    return { status: "missing", capture: capturePath };
  }
}

async function readClientSql(capturePath: string): Promise<RunClientSql> {
  const text = await readCaptureFile(capturePath).catch(() => null);
  if (text === null) return { status: "missing", capture: capturePath };
  try {
    return {
      status: "captured",
      capture: capturePath,
      summary: summarizeClientSqlCapture(parseClientSqlCapture(text)),
    };
  } catch {
    return { status: "missing", capture: capturePath };
  }
}

async function readPayloadAudit(capturePath: string): Promise<RunPayloadAudit> {
  const text = await readCaptureFile(capturePath).catch(() => null);
  if (text === null) return { status: "missing", capture: capturePath };
  try {
    return {
      status: "captured",
      capture: capturePath,
      summary: summarizePayloadAudit(parsePayloadAudit(text)),
    };
  } catch {
    return { status: "missing", capture: capturePath };
  }
}

/**
 * Runs one bob-and-alice scenario file alone with HTTP/operation capture on
 * and optional API statement, client SQLite, and payload-audit captures.
 */
export async function runScenario(
  input: ScenarioRunInput,
): Promise<ScenarioRun> {
  const root = input.root ?? bobAndAliceRoot;
  const preloads = [
    ...(await packagePreloads(root)),
    scenarioHttpPreload,
    ...(input.statements ? [capturePreload] : []),
    ...(input.clientSql ? [clientSqlPreload] : []),
  ];
  const { API_DATABASE: apiDatabase } = process.env;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    API_DATABASE: apiDatabase ?? "memory",
    PERF_SCENARIO_HTTP_OUT: input.httpCapture,
    ...(input.statements && {
      PERF_STATEMENTS_OUT: input.statements.out,
      PERF_STATEMENTS_PARAM_HASH: input.statements.paramHash ? "1" : "0",
    }),
    ...(input.clientSql && {
      PERF_CLIENT_SQL_OUT: input.clientSql.out,
    }),
    ...(input.payloadAudit && {
      PERF_PAYLOAD_AUDIT_OUT: input.payloadAudit.out,
      PERF_PAYLOAD_AUDIT_STACKS: input.payloadAudit.stacks ? "1" : "0",
    }),
  };
  const result = await runTestProcess({
    cwd: root,
    args: [
      ...preloads.flatMap((preload) => ["--preload", preload]),
      testFileArgument(input.scenario.file),
    ],
    env,
    log: input.log,
    timeoutMs: scenarioTimeoutMs,
  });
  const tests = parseBunTestCounts(await readFile(input.log, "utf8"));
  const http = await readHttpSummary(input.httpCapture);
  const status = scenarioRunStatus(
    result.exitCode,
    result.timedOut,
    tests,
    http,
  );
  const passed = status === "passed";
  return {
    scenario: input.scenario.name,
    file: input.scenario.file,
    sample: input.sample,
    status,
    exitCode: result.exitCode,
    wallMs: result.wallMs,
    tests,
    log: input.log,
    httpCapture: input.httpCapture,
    http,
    statements:
      passed && input.statements
        ? await readApiStatements(input.statements.out)
        : { status: "off" },
    ...(input.clientSql && {
      clientSql: passed
        ? await readClientSql(input.clientSql.out)
        : { status: "off" },
    }),
    ...(input.payloadAudit && {
      payloadAudit: passed
        ? await readPayloadAudit(input.payloadAudit.out)
        : { status: "off" },
    }),
  };
}
