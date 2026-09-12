/**
 * Implementation-trace projection for the NoBrickedDevice model. Scenario
 * tests in packages/client-sdk drive the real container-path verifier and
 * the real principal-policy verifier through the model's late-delivery,
 * revocation, rollback, fork, regression, and forged-signer shapes, record
 * each run as a sequence of abstract model actions with the outcome the
 * verifier produced, and write those traces here. For every trace this check
 * generates a TLC module (scripts/noBrickTraceModule.ts) whose next-state
 * relation conjoins the model's own action and the recorded outcome per
 * step, so a sequence the model rejects, or an outcome the model's rules
 * disagree with, deadlocks TLC and fails `check:fast`. Deliberately tampered
 * traces are validated as negative controls on every run (asserting the
 * deadlock specifically), so the oracle itself cannot silently go vacuous.
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
  MODEL_VOCABULARY,
  NO_BRICK_MODEL_DIRECTORY,
  NO_BRICK_MODEL_PATH,
  ProjectionError,
  parseRecordedTrace,
  projectionFail,
  type RecordedNoBrickTrace,
  renderTraceModule,
  traceModuleName,
} from "./noBrickTraceModule";
import { resolveTlcTools, runTlc, type TlcTools } from "./tlcTools";

// The scenario tests import only source modules and the shared test
// helpers, so the projection stays runnable in the always-on lint job
// without built package dist output or package-local test preloads.
const SCENARIO_TESTS: readonly string[] = [
  "packages/client-sdk/src/data/keyingProjectionVerification/noBrickContainerProjection.test.ts",
  "packages/client-sdk/src/data/keyingProjectionVerification/noBrickPolicyProjection.test.ts",
  "packages/client-sdk/src/data/keyingProjectionVerification/noBrickGroupProjection.test.ts",
];
const EXPECTED_TRACES = [
  "container-fresh-device",
  "container-group-late-delivery",
  "container-late-chain",
  "container-late-delivery",
  "policy-late-delivery",
];

/**
 * The recorder vocabulary must name declarations of the model itself, so a
 * model rename cannot leave this check speaking a stale dialect.
 */
function assertVocabularyMatchesModel(root: string): void {
  const moduleSource = readFileSync(join(root, NO_BRICK_MODEL_PATH), "utf8");
  const stale = MODEL_VOCABULARY.filter(
    (token) => !moduleDeclaresToken(moduleSource, token),
  );
  if (stale.length > 0) {
    projectionFail(
      `${NO_BRICK_MODEL_PATH} no longer declares: ${stale.join(", ")}. Update the projection vocabulary alongside the model.`,
    );
  }
}

function recordScenarioTraces(root: string, traceDirectory: string): void {
  const result = spawnSync("bun", ["test", ...SCENARIO_TESTS], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_BRICK_TRACE_DIR: traceDirectory },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    projectionFail(`scenario tests failed:\n${result.stdout}${result.stderr}`);
  }
}

function loadTraces(traceDirectory: string): RecordedNoBrickTrace[] {
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
  trace: RecordedNoBrickTrace,
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
    libraryPath: join(root, NO_BRICK_MODEL_DIRECTORY),
    modulePath,
  });
}

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
  const traceDirectory = mkdtempSync(
    join(tmpdir(), "tearleads-nobrick-traces-"),
  );
  const workDirectory = mkdtempSync(join(tmpdir(), "tearleads-nobrick-tlc-"));
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
        `${trace.scenario}: ${trace.steps.length} recorded steps accepted by NoBrickedDevice.`,
      );
    }

    const lateDelivery = traces.find(
      (trace) => trace.scenario === "container-late-delivery",
    );
    const policy = traces.find(
      (trace) => trace.scenario === "policy-late-delivery",
    );
    const group = traces.find(
      (trace) => trace.scenario === "container-group-late-delivery",
    );
    if (!lateDelivery || !policy || !group) {
      projectionFail("negative controls require the late-delivery traces.");
    }
    const negatives = [
      flippedOutcomeTrace(lateDelivery),
      droppedRevocationTrace(lateDelivery),
      flippedOutcomeTrace(policy),
      flippedOutcomeTrace(group),
      droppedRevocationTrace(group),
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
