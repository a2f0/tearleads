/**
 * Implementation-trace projection for the RestartProbeConvergence model. The
 * scenario tests in packages/client-sdk and packages/app drive the real
 * probe-signal kernels and interest-barrier seams, record each run as a
 * sequence of abstract model actions (with implementation-projected state
 * bits), and write those traces here. For every trace this check generates a
 * TLC module (scripts/protocol/restartProbeTraceModule.ts) whose next-state relation
 * conjoins the model's own action per recorded step, so a sequence — or a
 * projected bit — the model rejects deadlocks TLC and fails `check:fast`.
 * Deliberately tampered traces are validated as negative controls on every
 * run (asserting the deadlock specifically), so the oracle itself cannot
 * silently go vacuous. scripts/protocol/traceProjectionRunner.ts runs it.
 */
import {
  ACTION_TEMPLATES,
  OBSERVABLE_VARIABLES,
  parseRecordedTrace,
  projectionFail,
  RESTART_PROBE_MODEL_PATH,
  type RecordedRestartProbeTrace,
  renderTraceModule,
  traceModuleName,
} from "./restartProbeTraceModule";
import { requireTrace, runTraceProjection } from "./traceProjectionRunner";

// Run both source-only scenarios from scripts: root-level discovery can walk
// generated native trees, while the app package's test preload requires built
// SDK declarations. This check must work without either native or SDK builds.
const SCENARIO_TESTS: readonly string[] = [
  "../packages/client-sdk/src/stores/documents/documentStore/sync/restartProbeProjection.test.ts",
  "../packages/app/src/providers/sdk/restartProbeProjection.test.ts",
];
const EXPECTED_TRACES = [
  "interest-barrier-seams",
  "probe-signal-kernels",
  "startup-probe-deferral",
];

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

function negativeControls(
  traces: readonly RecordedRestartProbeTrace[],
): RecordedRestartProbeTrace[] {
  const missing = "negative controls require both recorded traces.";
  return [
    tamperedSequenceTrace(
      requireTrace(traces, "interest-barrier-seams", missing),
    ),
    tamperedObservationTrace(
      requireTrace(traces, "probe-signal-kernels", missing),
    ),
  ];
}

runTraceProjection({
  modelName: "RestartProbeConvergence",
  modelPath: RESTART_PROBE_MODEL_PATH,
  modelDirectory: "formal/document-sync",
  vocabulary: [...Object.keys(ACTION_TEMPLATES), ...OBSERVABLE_VARIABLES],
  scenarios: {
    cwd: "scripts",
    tests: SCENARIO_TESTS,
    traceDirectoryEnv: "RESTART_PROBE_TRACE_DIR",
  },
  expectedTraces: EXPECTED_TRACES,
  temporaryPrefix: "tearleads-probe",
  parseRecordedTrace,
  renderTraceModule,
  traceModuleName,
  negativeControls,
});
