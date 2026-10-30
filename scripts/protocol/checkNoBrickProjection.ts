/**
 * Implementation-trace projection for the NoBrickedDevice model. Scenario
 * tests in packages/client-sdk drive the real container-path verifier and
 * the real principal-policy verifier through the model's late-delivery,
 * revocation, rollback, fork, regression, and forged-signer shapes, record
 * each run as a sequence of abstract model actions with the outcome the
 * verifier produced, and write those traces here. For every trace this check
 * generates a TLC module (scripts/protocol/noBrickTraceModule.ts) whose next-state
 * relation conjoins the model's own action and the recorded outcome per
 * step, so a sequence the model rejects, or an outcome the model's rules
 * disagree with, deadlocks TLC and fails `check:fast`. Deliberately tampered
 * traces are validated as negative controls on every run (asserting the
 * deadlock specifically), so the oracle itself cannot silently go vacuous.
 * scripts/protocol/traceProjectionRunner.ts runs it.
 */
import {
  MODEL_VOCABULARY,
  NO_BRICK_MODEL_DIRECTORY,
  NO_BRICK_MODEL_PATH,
  parseRecordedTrace,
  projectionFail,
  type RecordedNoBrickTrace,
  renderTraceModule,
  traceModuleName,
} from "./noBrickTraceModule";
import { requireTrace, runTraceProjection } from "./traceProjectionRunner";

// The scenario tests import only source modules and the shared test
// helpers, so the projection stays runnable in the always-on lint job
// without built package dist output or package-local test preloads.
const SCENARIO_TESTS: readonly string[] = [
  "src/data/keyingProjectionVerification/noBrickContainerProjection.test.ts",
  "src/data/keyingProjectionVerification/noBrickPolicyProjection.test.ts",
  "src/data/keyingProjectionVerification/noBrickGroupProjection.test.ts",
  "src/data/keyingProjectionVerification/noBrickHistoricalPolicyProjection.test.ts",
];
const EXPECTED_TRACES = [
  "container-fresh-device",
  "container-group-late-delivery",
  "container-late-chain",
  "container-late-delivery",
  "historical-policy-delivery",
  "policy-late-delivery",
];

/** Flip the last recorded outcome: the rules are deterministic, so the model must disagree. */
function flippedOutcomeTrace(
  trace: RecordedNoBrickTrace,
): RecordedNoBrickTrace {
  const last = trace.steps.findLastIndex(
    (step) => step.action === "HonestSync" || step.action === "Verify",
  );
  if (last === -1) {
    projectionFail("negative control needs a verification step to flip.");
  }
  const steps = trace.steps.map((step, index) => {
    if (index !== last || !("observed" in step)) {
      return step;
    }
    return {
      ...step,
      observed: {
        outcome: step.observed.outcome === "accepted" ? "refused" : "accepted",
      },
    } as const;
  });
  return { ...trace, scenario: `${trace.scenario}-misprojected`, steps };
}

/**
 * Drop the revocation: a later head the verifier refused because its signer
 * had lost membership at the cited authority is then a head the model would
 * accept, and a served authority the model no longer has cannot be served.
 */
function droppedRevocationTrace(
  trace: RecordedNoBrickTrace,
): RecordedNoBrickTrace {
  const steps = trace.steps.filter(
    (step) => step.action !== "RevokeLateSigner",
  );
  if (steps.length === trace.steps.length) {
    projectionFail("negative control needs a RevokeLateSigner step to drop.");
  }
  return { ...trace, scenario: `${trace.scenario}-unrevoked`, steps };
}

function negativeControls(
  traces: readonly RecordedNoBrickTrace[],
): RecordedNoBrickTrace[] {
  const missing = "negative controls require the late-delivery traces.";
  const lateDelivery = requireTrace(traces, "container-late-delivery", missing);
  const policy = requireTrace(traces, "policy-late-delivery", missing);
  const group = requireTrace(traces, "container-group-late-delivery", missing);
  const historical = requireTrace(
    traces,
    "historical-policy-delivery",
    missing,
  );
  return [
    flippedOutcomeTrace(historical),
    flippedOutcomeTrace(lateDelivery),
    droppedRevocationTrace(lateDelivery),
    flippedOutcomeTrace(policy),
    flippedOutcomeTrace(group),
    droppedRevocationTrace(group),
  ];
}

runTraceProjection({
  modelName: "NoBrickedDevice",
  modelPath: NO_BRICK_MODEL_PATH,
  modelDirectory: NO_BRICK_MODEL_DIRECTORY,
  vocabulary: MODEL_VOCABULARY,
  scenarios: {
    cwd: "packages/client-sdk",
    tests: SCENARIO_TESTS,
    traceDirectoryEnv: "NO_BRICK_TRACE_DIR",
  },
  expectedTraces: EXPECTED_TRACES,
  temporaryPrefix: "tearleads-nobrick",
  parseRecordedTrace,
  renderTraceModule,
  traceModuleName,
  negativeControls,
});
