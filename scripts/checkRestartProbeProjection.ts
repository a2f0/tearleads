/**
 * Implementation-trace projection for the RestartProbeConvergence model. The
 * scenario tests in packages/client-sdk and packages/app drive the real
 * probe-signal kernels and interest-barrier seams, record each run as a
 * sequence of abstract model actions (with implementation-projected state
 * bits), and write those traces here. For every trace this check generates a
 * TLC module whose next-state relation conjoins the model's own action per
 * recorded step, so a sequence — or a projected bit — the model rejects
 * deadlocks TLC and fails `check:fast`. A deliberately tampered trace is
 * validated as a negative control on every run, so the oracle itself cannot
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
import { resolveTlcTools, runTlc, type TlcTools } from "./tlcTools";

// Both scenario tests run from the repository root: they import only source
// modules (the app scenario's client-sdk import is type-only), so the
// projection stays runnable in the always-on lint job without built package
// dist output or package-local test preloads.
const SCENARIO_TESTS: readonly string[] = [
  "packages/client-sdk/src/stores/documents/documentStore/restartProbeProjection.test.ts",
  "packages/app/src/providers/sdk/restartProbeProjection.test.ts",
];
const EXPECTED_TRACES = ["interest-barrier-seams", "probe-signal-kernels"];

interface TraceStep {
  readonly action: string;
  readonly delivered?: boolean;
  readonly observed?: { readonly probeRequested?: boolean };
}

interface RecordedTrace {
  readonly model: string;
  readonly scenario: string;
  readonly steps: readonly TraceStep[];
}

const ACTION_TEMPLATES: Readonly<Record<string, string>> = {
  AcknowledgeKnownContainers: "AcknowledgeKnownContainers",
  BeginProbe: "BeginProbe",
  DeclareKnownContainers: "DeclareKnownContainers",
  DisconnectEvents: "DisconnectEvents",
  FinishProbe: "FinishProbe",
  InitializeOpenedPersistedDocument: "InitializeOpenedPersistedDocument",
  MarkContainerTreeReady: "MarkContainerTreeReady",
  ReceiveInterestBaseline: "ReceiveInterestBaseline",
  RemoteBodyAdvance: "RemoteBodyAdvance(%DELIVERED%)",
  RemoteSlotAdvance: "RemoteSlotAdvance(%DELIVERED%)",
  Restart: "Restart",
};

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function recordScenarioTraces(root: string, traceDirectory: string): void {
  for (const testPath of SCENARIO_TESTS) {
    const result = spawnSync("bun", ["test", testPath], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, RESTART_PROBE_TRACE_DIR: traceDirectory },
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
      fail(
        `scenario test ${testPath} failed:\n${result.stdout}${result.stderr}`,
      );
    }
  }
}

function loadTraces(traceDirectory: string): RecordedTrace[] {
  const names = readdirSync(traceDirectory).sort();
  const traces = names.map(
    (name): RecordedTrace =>
      JSON.parse(readFileSync(join(traceDirectory, name), "utf8")),
  );
  const scenarios = traces.map((trace) => trace.scenario).sort();
  if (JSON.stringify(scenarios) !== JSON.stringify(EXPECTED_TRACES)) {
    fail(
      `expected recorded traces ${EXPECTED_TRACES.join(", ")}; found ${scenarios.join(", ") || "none"}.`,
    );
  }
  return traces;
}

function traceStepFormula(step: TraceStep, index: number): string {
  const template = ACTION_TEMPLATES[step.action];
  if (!template) {
    fail(`trace step ${index + 1} names unknown model action ${step.action}.`);
  }
  if (template.includes("%DELIVERED%") && typeof step.delivered !== "boolean") {
    fail(`trace step ${index + 1} (${step.action}) is missing "delivered".`);
  }
  const action = template.replace(
    "%DELIVERED%",
    step.delivered ? "TRUE" : "FALSE",
  );
  const observations = Object.entries(step.observed ?? {}).map(
    ([variable, value]) => `/\\ ${variable}' = ${value ? "TRUE" : "FALSE"}`,
  );
  return [`${action}`, ...observations].join(" ");
}

function moduleName(trace: RecordedTrace, suffix: string): string {
  return `Trace${trace.scenario
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("")}${suffix}`;
}

function renderTraceModule(
  name: string,
  trace: RecordedTrace,
): { readonly cfg: string; readonly module: string } {
  const cases = trace.steps
    .map(
      (step, index) =>
        `    ${index === 0 ? "  " : "[]"} step = ${index + 1} -> ${traceStepFormula(step, index)}`,
    )
    .join("\n");
  const advances = (action: string): number =>
    trace.steps.filter((step) => step.action === action).length;
  const maxVersion = Math.max(
    1,
    advances("RemoteBodyAdvance"),
    advances("RemoteSlotAdvance"),
  );
  const maxDisconnects = Math.max(1, advances("DisconnectEvents"));

  const module = `---- MODULE ${name} ----
EXTENDS RestartProbeConvergence, Naturals

VARIABLE idx

TraceLen == ${trace.steps.length}

TraceStep(step) ==
  CASE${cases.slice(4)}
    [] OTHER -> FALSE

TInit == Init /\\ idx = 0

TNext ==
  \\/ /\\ idx < TraceLen
     /\\ idx' = idx + 1
     /\\ TraceStep(idx + 1)
  \\/ /\\ idx = TraceLen
     /\\ UNCHANGED vars
     /\\ idx' = idx

TSpec == TInit /\\ [][TNext]_<< vars, idx >>
====
`;
  const cfg = `SPECIFICATION TSpec

CONSTANTS
  MaxVersion = ${maxVersion}
  MaxDisconnects = ${maxDisconnects}

INVARIANT TypeOK
`;
  return { cfg, module };
}

function checkTrace(
  tools: TlcTools,
  root: string,
  workDirectory: string,
  trace: RecordedTrace,
  suffix = "",
): { readonly ok: boolean; readonly output: string } {
  if (trace.model !== "RestartProbeConvergence") {
    fail(`trace ${trace.scenario} targets unknown model ${trace.model}.`);
  }
  const name = moduleName(trace, suffix);
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

function tamperedSequenceTrace(trace: RecordedTrace): RecordedTrace {
  // Drop the declaration but keep its acknowledgement: the model's barrier
  // (an ack requires an outstanding declaration) must reject the sequence.
  const withoutDeclaration = trace.steps.filter(
    (step) => step.action !== "DeclareKnownContainers",
  );
  if (withoutDeclaration.length === trace.steps.length) {
    fail("negative control needs a DeclareKnownContainers step to remove.");
  }
  return {
    ...trace,
    scenario: `${trace.scenario}-tampered`,
    steps: withoutDeclaration,
  };
}

function tamperedObservationTrace(trace: RecordedTrace): RecordedTrace {
  // Flip the final settled FinishProbe observation: the model computes
  // probeRequested' = FALSE there, so a projected TRUE must be rejected.
  const lastFinish = trace.steps.findLastIndex(
    (step) =>
      step.action === "FinishProbe" && step.observed?.probeRequested === false,
  );
  if (lastFinish === -1) {
    fail("negative control needs a settled FinishProbe observation to flip.");
  }
  const steps = trace.steps.map((step, index) =>
    index === lastFinish
      ? { ...step, observed: { probeRequested: true } }
      : step,
  );
  return { ...trace, scenario: `${trace.scenario}-misprojected`, steps };
}

const root = process.cwd();
const tools = resolveTlcTools(root);
const traceDirectory = mkdtempSync(join(tmpdir(), "tearleads-probe-traces-"));
const workDirectory = mkdtempSync(join(tmpdir(), "tearleads-probe-tlc-"));
try {
  recordScenarioTraces(root, traceDirectory);
  const traces = loadTraces(traceDirectory);

  for (const trace of traces) {
    const result = checkTrace(tools, root, workDirectory, trace);
    if (!result.ok) {
      fail(
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
    fail("negative controls require both recorded traces.");
  }
  const negatives = [
    tamperedSequenceTrace(interestTrace),
    tamperedObservationTrace(probeTrace),
  ];
  for (const negative of negatives) {
    const result = checkTrace(tools, root, workDirectory, negative, "Negative");
    if (result.ok) {
      fail(
        `the ${negative.scenario} negative-control trace was accepted; the projection oracle is vacuous.`,
      );
    }
    console.log(`negative control: ${negative.scenario} rejected as expected.`);
  }
} finally {
  rmSync(traceDirectory, { force: true, recursive: true });
  rmSync(workDirectory, { force: true, recursive: true });
}
