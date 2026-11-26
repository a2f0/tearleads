/**
 * A Bun test preload that writes every statement the API's ORM sends to a
 * JSON-lines file, one record per statement, and a marker at the end of
 * every request-volume canary phase. Name the tested package's own preloads
 * before it, so they configure the database first:
 *
 *   PERF_STATEMENTS_OUT=<file> bun test --preload ./test/preload.ts \
 *     --preload <this file> ./src/<file>.test.ts
 *
 * `bun run perf:statements` and `bun run perf:canaries --statements` do
 * that and summarize the file. See `recorder.ts` for the record shapes and
 * the README for the environment variables.
 */
import { beforeEach } from "bun:test";
import { appendFileSync } from "node:fs";
import { observeDatabaseStatements } from "@tearleads/api-shared/statement-observer";
import {
  createStatementRecorder,
  phaseFromConsole,
  readCaptureEnvironment,
} from "./recorder";

const environment = readCaptureEnvironment(process.env);
const probe = globalThis as { sqlCaptureLabel?: string | undefined };
const recorder = createStatementRecorder({
  paramHash: environment.paramHash,
  limit: environment.limit,
  write: (line) => appendFileSync(environment.out, line, { mode: 0o600 }),
  label: () => probe.sqlCaptureLabel,
});

beforeEach(() => {
  recorder.startTest();
  probe.sqlCaptureLabel = undefined;
});

observeDatabaseStatements(({ sql, parameters, scope }) =>
  recorder.statement(sql, parameters, scope),
);

const info = console.info.bind(console);
console.info = (...args: unknown[]) => {
  const phase = phaseFromConsole(args);
  if (phase) recorder.phaseEnd(phase.label, phase.requests);
  info(...args);
};
