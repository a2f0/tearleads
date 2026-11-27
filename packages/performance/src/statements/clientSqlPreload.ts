/**
 * Bun test preload that records client SQLite statements and serialized
 * mutation-lock holds via `@tearleads/client-sdk/sqlite` into a bounded JSONL
 * file (`PERF_CLIENT_SQL_OUT`). Used by `perf:canaries --client-statements`.
 */
import { beforeEach } from "bun:test";
import {
  observeClientSqlMutations,
  observeClientSqlStatements,
} from "@tearleads/client-sdk/sqlite";
import { createCaptureWriter } from "./captureFile";
import type { ClientSqlRecord } from "./clientSqlSummary";
import { phaseFromConsole, phaseStartFromConsole } from "./recorder";

interface ClientSqlEnv {
  readonly [name: string]: string | undefined;
  readonly PERF_CLIENT_SQL_OUT?: string;
  readonly PERF_CLIENT_SQL_LIMIT?: string;
}

const defaultLimit = 500_000;

function readEnv(env: ClientSqlEnv) {
  const out = env.PERF_CLIENT_SQL_OUT;
  if (!out) {
    throw new Error("PERF_CLIENT_SQL_OUT must name the capture file.");
  }
  const rawLimit = env.PERF_CLIENT_SQL_LIMIT;
  if (rawLimit !== undefined && !/^[1-9]\d*$/u.test(rawLimit)) {
    throw new Error("PERF_CLIENT_SQL_LIMIT must be a positive integer.");
  }
  return {
    out,
    limit: rawLimit === undefined ? defaultLimit : Number(rawLimit),
  };
}

const { out, limit } = readEnv(process.env);
const write = createCaptureWriter(out);
let testNumber = 0;
let written = 0;

function record(entry: ClientSqlRecord): void {
  if (written > limit) return;
  written += 1;
  write(`${JSON.stringify(written > limit ? { truncated: limit } : entry)}\n`);
}

function currentLabel(): string {
  const custom: unknown = Reflect.get(globalThis, "sqlCaptureLabel");
  return typeof custom === "string" ? custom : `test-${testNumber}`;
}

beforeEach(() => {
  testNumber += 1;
});

observeClientSqlStatements((stmt) => {
  record({
    kind: "stmt",
    label: currentLabel(),
    sql: stmt.sql,
    bindCount: stmt.bindCount,
    durationMs: stmt.durationMs,
    rows: stmt.rowCount,
    inLock: stmt.inMutationLock,
    failed: stmt.failed,
  });
});

observeClientSqlMutations((mut) => {
  record({
    kind: "mutation",
    label: currentLabel(),
    waitMs: mut.waitMs,
    holdMs: mut.holdMs,
    statements: mut.statements,
    failed: mut.failed,
  });
});

const info = console.info.bind(console);
console.info = (...args: unknown[]) => {
  const started = phaseStartFromConsole(args);
  if (started !== null) record({ phaseStart: started });
  const phase = phaseFromConsole(args);
  if (phase) record({ phaseEnd: phase.label, requests: phase.requests });
  info(...args);
};
