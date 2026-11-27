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
import {
  observeDatabaseRequestScopes,
  observeDatabaseStatements,
} from "@tearleads/api-shared/statement-observer";
import { createCaptureWriter } from "./captureFile";
import {
  createStatementRecorder,
  phaseFromConsole,
  phaseStartFromConsole,
  readCaptureEnvironment,
} from "./recorder";

const environment = readCaptureEnvironment(process.env);
/** The global a probe sets around the work it measures. */
const labelKey = "sqlCaptureLabel";

function probeLabel(): string | undefined {
  const label: unknown = Reflect.get(globalThis, labelKey);
  return typeof label === "string" ? label : undefined;
}

const recorder = createStatementRecorder({
  paramHash: environment.paramHash,
  limit: environment.limit,
  write: createCaptureWriter(environment.out),
  label: probeLabel,
});

beforeEach(() => {
  recorder.startTest();
  Reflect.set(globalThis, labelKey, undefined);
});

observeDatabaseStatements(({ sql, parameters, scope, transaction }) =>
  recorder.statement(sql, parameters, scope, transaction),
);

observeDatabaseRequestScopes(({ scope, method, route, status }) =>
  recorder.requestScope(scope, { method, route, status }),
);

const info = console.info.bind(console);
console.info = (...args: unknown[]) => {
  const started = phaseStartFromConsole(args);
  if (started !== null) recorder.phaseStart(started);
  const phase = phaseFromConsole(args);
  if (phase) recorder.phaseEnd(phase.label, phase.requests);
  info(...args);
};
