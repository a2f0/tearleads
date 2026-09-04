/**
 * Implementation-trace projection for the RestartProbeConvergence model. The
 * scenario tests in packages/client-sdk and packages/app drive the real
 * probe-signal kernels and interest-barrier seams, record each run as a
 * sequence of abstract model actions (with implementation-projected state
 * bits), and write those traces here. For every trace this check generates a
 * TLC module (scripts/restartProbeTraceModule.ts) whose next-state relation
 * conjoins the model's own action per recorded step, so a sequence — or a
 * projected bit — the model rejects deadlocks TLC and fails `check:fast`.
 * Deliberately tampered traces are validated as negative controls on every
 * run (asserting the deadlock specifically), so the oracle itself cannot
 * silently go vacuous.
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
import {
  ACTION_TEMPLATES,
  OBSERVABLE_VARIABLES,
  ProjectionError,
  parseRecordedTrace,
  projectionFail,
  RESTART_PROBE_MODEL_PATH,
  type RecordedRestartProbeTrace,
  renderTraceModule,
  traceModuleName,
} from "./restartProbeTraceModule";
import { resolveTlcTools, runTlc, type TlcTools } from "./tlcTools";

// Both scenario tests run from the repository root in one invocation: they
// import only source modules (the app scenario's client-sdk import is
// type-only), so the projection stays runnable in the always-on lint job
// without built package dist output or package-local test preloads.
const SCENARIO_TESTS: readonly string[] = [
  "packages/client-sdk/src/stores/documents/documentStore/restartProbeProjection.test.ts",
  "packages/app/src/providers/sdk/restartProbeProjection.test.ts",
];
const EXPECTED_TRACES = ["interest-barrier-seams", "probe-signal-kernels"];

/**
 * The recorder vocabulary and observable projection must name declarations of
 * the model itself, so a model rename cannot leave this check speaking a
 * stale dialect.
 */
function assertVocabularyMatchesModel(root: string): void {
  const moduleSource = readFileSync(
    join(root, RESTART_PROBE_MODEL_PATH),
    "utf8",
  );
  const stale = [
    ...Object.keys(ACTION_TEMPLATES),
    ...OBSERVABLE_VARIABLES,
  ].filter((token) => !moduleDeclaresToken(moduleSource, token));
  if (stale.length > 0) {
    projectionFail(
      `${RESTART_PROBE_MODEL_PATH} no longer declares: ${stale.join(", ")}. Update the projection vocabulary alongside the model.`,
    );
  }
}

function recordScenarioTraces(root: string, traceDirectory: string): void {
  const result = spawnSync("bun", ["test", ...SCENARIO_TESTS], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, RESTART_PROBE_TRACE_DIR: traceDirectory },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    projectionFail(`scenario tests failed:\n${result.stdout}${result.stderr}`);
  }
}

function loadTraces(traceDirectory: string): RecordedRestartProbeTrace[] {
  const names = readdirSync(traceDirectory).sort();
  const traces = names.map((name) =>
    parseRecordedTrace(name, readFileSync(join(traceDirectory, name), "utf8")),
  );
  const scenarios = traces.map((trace) => trace.scenario).sort();
  if (JSON.stringify(scenarios) !== JSON.stringify(EXPECTED_TRACES)) {
    projectionFail(
      `expected recorded traces ${EXPECTED_TRACES.join(", ")}; found ${scenarios.join(", ") || "none"}.`,
    );
  }
  return traces;
}

function checkTrace(
  tools: TlcTools,
  root: string,
  workDirectory: string,
  trace: RecordedRestartProbeTrace,
  suffix = "",
): { readonly ok: boolean; readonly output: string } {
  const name = traceModuleName(trace, suffix);
  const rendered = renderTraceModule(name, trace);
  const modulePath = join(workDirectory, `${name}.tla`);
  const configPath = join(workDirectory, `${name}.cfg`);
  writeFileSync(modulePath, rendered.module);
  writeFileSync(configPath, rendered.cfg);
  return runTlc(tools, {
    configPath,
    cwd: workDirectory,
    libraryPath: join(root, "formal", "document-sync"),
    modulePath,
  });
}

function tamperedSequenceTrace(
  trace: RecordedRestartProbeTrace,
): RecordedRestartProbeTrace {
  // Drop the declaration but keep its acknowledgement: the model's barrier
  // (an ack requires an outstanding declaration) must reject the sequence.
  const withoutDeclaration = trace.steps.filter(
    (step) => step.action !== "DeclareKnownContainers",
  );
  if (withoutDeclaration.length === trace.steps.length) {
    projectionFail(
      "negative control needs a DeclareKnownContainers step to remove.",
    );
  }
  return {
    ...trace,
    scenario: `${trace.scenario}-tampered`,
    steps: withoutDeclaration,
  };
}

function tamperedObservationTrace(
  trace: RecordedRestartProbeTrace,
): RecordedRestartProbeTrace {
  // Flip the final settled FinishProbe observation: the model computes
  // probeRequested' = FALSE there, so a projected TRUE must be rejected.
  const lastFinish = trace.steps.findLastIndex(
    (step) =>
      step.action === "FinishProbe" && step.observed?.probeRequested === false,
  );
  if (lastFinish === -1) {
    projectionFail(
      "negative control needs a settled FinishProbe observation to flip.",
    );
  }
  const steps = trace.steps.map((step, index) =>
    index === lastFinish
      ? { ...step, observed: { probeRequested: true } }
      : step,
  );
  return { ...trace, scenario: `${trace.scenario}-misprojected`, steps };
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

function runProjectionCheck(): void {
  const root = repoRoot();
  assertVocabularyMatchesModel(root);
  const tools = resolveTlcTools(root);
  const traceDirectory = mkdtempSync(join(tmpdir(), "tearleads-probe-traces-"));
  const workDirectory = mkdtempSync(join(tmpdir(), "tearleads-probe-tlc-"));
  try {
    recordScenarioTraces(root, traceDirectory);
    const traces = loadTraces(traceDirectory);

    for (const trace of traces) {
      const result = checkTrace(tools, root, workDirectory, trace);
      if (!result.ok) {
        projectionFail(
          `the model rejected the recorded ${trace.scenario} trace:\n${result.output}`,
        );
      }
      console.log(
        `${trace.scenario}: ${trace.steps.length} recorded steps accepted by RestartProbeConvergence.`,
      );
    }

    const interestTrace = traces.find(
      (trace) => trace.scenario === "interest-barrier-seams",
    );
    const probeTrace = traces.find(
      (trace) => trace.scenario === "probe-signal-kernels",
    );
    if (!interestTrace || !probeTrace) {
      projectionFail("negative controls require both recorded traces.");
    }
    const negatives = [
      tamperedSequenceTrace(interestTrace),
      tamperedObservationTrace(probeTrace),
    ];
    for (const negative of negatives) {
      const result = checkTrace(
        tools,
        root,
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

try {
  runProjectionCheck();
} catch (error) {
  if (error instanceof ProjectionError) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
