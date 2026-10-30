/**
 * Shared runner for the implementation-trace projections
 * (checkNoBrickProjection.ts, checkRestartProbeProjection.ts). Each projection
 * names its model, the scenario tests that record traces, and its negative
 * controls; this module records the traces, checks every one with TLC, and
 * requires every negative control to deadlock, so a model the recorded
 * implementation disagrees with fails `check:fast`.
 */
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleDeclaresToken } from "./lintFormalAbstractionMaps";
import { resolveTlcTools, runTlc, type TlcTools } from "./tlcTools";

export class ProjectionError extends Error {}

export function projectionFail(message: string): never {
  throw new ProjectionError(message);
}

export interface RecordedProjectionTrace {
  readonly scenario: string;
  readonly steps: readonly unknown[];
}

export interface TraceProjection<Trace extends RecordedProjectionTrace> {
  /** TLA+ module name, used in progress output. */
  readonly modelName: string;
  /** Model source, relative to the repository root. */
  readonly modelPath: string;
  /** TLC library directory holding the model, relative to the root. */
  readonly modelDirectory: string;
  /** Recorder tokens the model source must still declare. */
  readonly vocabulary: readonly string[];
  /** Scenario tests, run with `bun test` from `cwd` (relative to the root). */
  readonly scenarios: {
    readonly cwd: string;
    readonly tests: readonly string[];
    /** Environment variable naming the directory the tests write traces to. */
    readonly traceDirectoryEnv: string;
  };
  /** Every scenario the tests must record, sorted. */
  readonly expectedTraces: readonly string[];
  /** Prefix for the temporary trace and TLC work directories. */
  readonly temporaryPrefix: string;
  readonly parseRecordedTrace: (name: string, raw: string) => Trace;
  readonly renderTraceModule: (
    name: string,
    trace: Trace,
  ) => { readonly cfg: string; readonly module: string };
  readonly traceModuleName: (trace: Trace, suffix: string) => string;
  /** Tampered traces the model must refuse with a deadlock. */
  readonly negativeControls: (traces: readonly Trace[]) => readonly Trace[];
}

/** The recorder vocabulary must name declarations of the model itself. */
function assertVocabularyMatchesModel(
  root: string,
  projection: Pick<
    TraceProjection<RecordedProjectionTrace>,
    "modelPath" | "vocabulary"
  >,
): void {
  const moduleSource = readFileSync(join(root, projection.modelPath), "utf8");
  const stale = projection.vocabulary.filter(
    (token) => !moduleDeclaresToken(moduleSource, token),
  );
  if (stale.length > 0) {
    projectionFail(
      `${projection.modelPath} no longer declares: ${stale.join(", ")}. Update the projection vocabulary alongside the model.`,
    );
  }
}

function recordScenarioTraces(
  root: string,
  scenarios: TraceProjection<RecordedProjectionTrace>["scenarios"],
  traceDirectory: string,
): void {
  const { cwd, tests, traceDirectoryEnv } = scenarios;
  const result = spawnSync("bun", ["test", ...tests], {
    cwd: join(root, cwd),
    encoding: "utf8",
    env: { ...process.env, [traceDirectoryEnv]: traceDirectory },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    projectionFail(`scenario tests failed:\n${result.stdout}${result.stderr}`);
  }
}

function loadTraces<Trace extends RecordedProjectionTrace>(
  projection: TraceProjection<Trace>,
  traceDirectory: string,
): Trace[] {
  const names = readdirSync(traceDirectory).sort();
  const traces = names.map((name) =>
    projection.parseRecordedTrace(
      name,
      readFileSync(join(traceDirectory, name), "utf8"),
    ),
  );
  const scenarios = traces.map((trace) => trace.scenario).sort();
  if (JSON.stringify(scenarios) !== JSON.stringify(projection.expectedTraces)) {
    projectionFail(
      `expected recorded traces ${projection.expectedTraces.join(", ")}; found ${scenarios.join(", ") || "none"}.`,
    );
  }
  return traces;
}

function checkTrace<Trace extends RecordedProjectionTrace>(
  tools: TlcTools,
  root: string,
  projection: TraceProjection<Trace>,
  workDirectory: string,
  trace: Trace,
  suffix = "",
): { readonly ok: boolean; readonly output: string } {
  const name = projection.traceModuleName(trace, suffix);
  const rendered = projection.renderTraceModule(name, trace);
  const modulePath = join(workDirectory, `${name}.tla`);
  const configPath = join(workDirectory, `${name}.cfg`);
  writeFileSync(modulePath, rendered.module);
  writeFileSync(configPath, rendered.cfg);
  return runTlc(tools, {
    configPath,
    cwd: workDirectory,
    libraryPath: join(root, projection.modelDirectory),
    modulePath,
  });
}

function repoRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    projectionFail("the projection check must run inside a Git repository.");
  }
  return result.stdout.trim();
}

function checkProjection<Trace extends RecordedProjectionTrace>(
  projection: TraceProjection<Trace>,
): void {
  const root = repoRoot();
  assertVocabularyMatchesModel(root, projection);
  const tools = resolveTlcTools(root);
  const traceDirectory = mkdtempSync(
    join(tmpdir(), `${projection.temporaryPrefix}-traces-`),
  );
  const workDirectory = mkdtempSync(
    join(tmpdir(), `${projection.temporaryPrefix}-tlc-`),
  );
  try {
    recordScenarioTraces(root, projection.scenarios, traceDirectory);
    const traces = loadTraces(projection, traceDirectory);

    for (const trace of traces) {
      const result = checkTrace(tools, root, projection, workDirectory, trace);
      if (!result.ok) {
        projectionFail(
          `the model rejected the recorded ${trace.scenario} trace:\n${result.output}`,
        );
      }
      console.log(
        `${trace.scenario}: ${trace.steps.length} recorded steps accepted by ${projection.modelName}.`,
      );
    }

    for (const negative of projection.negativeControls(traces)) {
      const result = checkTrace(
        tools,
        root,
        projection,
        workDirectory,
        negative,
        "Negative",
      );
      // Only a deadlock is the model refusing the sequence; any other failure
      // (a generation bug, a JVM error) must not pass as proof of non-vacuity.
      if (result.ok || !result.output.includes("Deadlock reached")) {
        projectionFail(
          `the ${negative.scenario} negative-control trace did not deadlock; the projection oracle may be vacuous:\n${result.output}`,
        );
      }
      console.log(
        `negative control: ${negative.scenario} rejected as expected.`,
      );
    }
  } finally {
    rmSync(traceDirectory, { force: true, recursive: true });
    rmSync(workDirectory, { force: true, recursive: true });
  }
}

/** Runs the projection check as a script: a projection failure exits 1. */
export function runTraceProjection<Trace extends RecordedProjectionTrace>(
  projection: TraceProjection<Trace>,
): void {
  try {
    checkProjection(projection);
  } catch (error) {
    if (error instanceof ProjectionError) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

/** The recorded trace for `scenario`, which a negative control needs. */
export function requireTrace<Trace extends RecordedProjectionTrace>(
  traces: readonly Trace[],
  scenario: string,
  message: string,
): Trace {
  const trace = traces.find((candidate) => candidate.scenario === scenario);
  if (!trace) {
    projectionFail(message);
  }
  return trace;
}
