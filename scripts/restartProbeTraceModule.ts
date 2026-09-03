/**
 * Pure trace-to-TLC projection for the RestartProbeConvergence model: the
 * recorded-trace schema, the action vocabulary, and the generator that turns
 * one recorded trace into a TLC module whose next-state relation conjoins the
 * model's own action (plus recorded observation bits) per step. The
 * orchestration — running the scenario tests, invoking TLC, negative
 * controls — lives in scripts/checkRestartProbeProjection.ts.
 */

export const RESTART_PROBE_MODEL_PATH =
  "formal/document-sync/RestartProbeConvergence.tla";
export const OBSERVABLE_VARIABLES = ["probeRequested"];

export interface RestartProbeTraceStep {
  readonly action: string;
  readonly delivered?: boolean;
  readonly observed?: { readonly probeRequested?: boolean };
}

export interface RecordedRestartProbeTrace {
  readonly model: string;
  readonly scenario: string;
  readonly steps: readonly RestartProbeTraceStep[];
}

export const ACTION_TEMPLATES: Readonly<Record<string, string>> = {
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

export class ProjectionError extends Error {}

export function projectionFail(message: string): never {
  throw new ProjectionError(message);
}

export function parseRecordedTrace(
  name: string,
  raw: string,
): RecordedRestartProbeTrace {
  const trace: RecordedRestartProbeTrace = JSON.parse(raw);
  if (
    trace.model !== "RestartProbeConvergence" ||
    typeof trace.scenario !== "string" ||
    !Array.isArray(trace.steps) ||
    trace.steps.some(
      (step) =>
        typeof step.action !== "string" ||
        Object.keys(step.observed ?? {}).some(
          (variable) => !OBSERVABLE_VARIABLES.includes(variable),
        ),
    )
  ) {
    projectionFail(`recorded trace ${name} is malformed.`);
  }
  return trace;
}

export function traceStepFormula(
  step: RestartProbeTraceStep,
  index: number,
): string {
  const template = ACTION_TEMPLATES[step.action];
  if (!template) {
    projectionFail(
      `trace step ${index + 1} names unknown model action ${step.action}.`,
    );
  }
  if (template.includes("%DELIVERED%") && typeof step.delivered !== "boolean") {
    projectionFail(
      `trace step ${index + 1} (${step.action}) is missing "delivered".`,
    );
  }
  const action = template.replace(
    "%DELIVERED%",
    step.delivered ? "TRUE" : "FALSE",
  );
  const observations = Object.entries(step.observed ?? {}).map(
    ([variable, value]) => `/\\ ${variable}' = ${value ? "TRUE" : "FALSE"}`,
  );
  return [action, ...observations].join(" ");
}

export function traceModuleName(
  trace: RecordedRestartProbeTrace,
  suffix: string,
): string {
  return `Trace${trace.scenario
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("")}${suffix}`;
}

export function renderTraceModule(
  name: string,
  trace: RecordedRestartProbeTrace,
): { readonly cfg: string; readonly module: string } {
  if (trace.steps.length === 0) {
    projectionFail(`trace ${trace.scenario} records no steps.`);
  }
  const cases = trace.steps
    .map(
      (step, index) =>
        `    ${index === 0 ? "CASE" : "  []"} step = ${index + 1} -> ${traceStepFormula(step, index)}`,
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
${cases}
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
