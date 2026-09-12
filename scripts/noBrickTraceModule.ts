/**
 * Pure trace-to-TLC projection for the NoBrickedDevice model: the recorded
 * trace schema, the action vocabulary, and the generator that turns one
 * recorded trace into a TLC module whose next-state relation conjoins the
 * model's own action (plus the recorded verification outcome) per step. The
 * orchestration — running the scenario tests, invoking TLC, negative controls
 * — lives in scripts/checkNoBrickProjection.ts.
 */

export const NO_BRICK_MODEL_PATH =
  "formal/container-keying/NoBrickedDevice.tla";
export const NO_BRICK_MODEL_DIRECTORY = "formal/container-keying";

/** Model declarations the projection names; the check pins them to the module. */
export const MODEL_VOCABULARY = [
  "AdvanceAuthority",
  "RevokeLateSigner",
  "CommitDependent",
  "SyncAuthority",
  "HonestSync",
  "Verify",
  "WellFormed",
  "checkpoint",
  "outcome",
  "honestRefused",
] as const;

const OUTCOMES = ["accepted", "refused"] as const;
const DEVICE_PATTERN = /^[a-z][a-z0-9]*$/;

export type NoBrickOutcome = (typeof OUTCOMES)[number];

export interface NoBrickProjection {
  readonly head: number;
  readonly honestPrefix: number;
  readonly cited: number;
  readonly late: boolean;
  readonly authority: number;
}

export type NoBrickTraceStep =
  | { readonly action: "AdvanceAuthority" }
  | { readonly action: "RevokeLateSigner" }
  | { readonly action: "CommitDependent"; readonly late: boolean }
  | { readonly action: "SyncAuthority"; readonly device: string }
  | {
      readonly action: "HonestSync";
      readonly device: string;
      readonly observed: { readonly outcome: NoBrickOutcome };
    }
  | {
      readonly action: "Verify";
      readonly device: string;
      readonly projection: NoBrickProjection;
      readonly observed: { readonly outcome: NoBrickOutcome };
    };

export interface RecordedNoBrickTrace {
  readonly model: "NoBrickedDevice";
  readonly scenario: string;
  readonly initialCheckpoints: Readonly<Record<string, 0 | 1>>;
  readonly steps: readonly NoBrickTraceStep[];
}

export class ProjectionError extends Error {}

export function projectionFail(message: string): never {
  throw new ProjectionError(message);
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOutcome(value: unknown): value is NoBrickOutcome {
  return OUTCOMES.some((outcome) => outcome === value);
}

interface LooseObserved {
  readonly outcome?: unknown;
}

interface LooseProjection {
  readonly head?: unknown;
  readonly honestPrefix?: unknown;
  readonly cited?: unknown;
  readonly late?: unknown;
  readonly authority?: unknown;
}

interface LooseStep {
  readonly action?: unknown;
  readonly late?: unknown;
  readonly device?: unknown;
  readonly observed?: unknown;
  readonly projection?: unknown;
}

interface LooseTrace {
  readonly model?: unknown;
  readonly scenario?: unknown;
  readonly initialCheckpoints?: unknown;
  readonly steps?: unknown;
}

function isObservedOutcome(value: unknown): boolean {
  if (!isObject(value) || Object.keys(value).length !== 1) {
    return false;
  }
  const observed: LooseObserved = value;
  return isOutcome(observed.outcome);
}

function isProjection(value: unknown): value is NoBrickProjection {
  if (!isObject(value) || Object.keys(value).length !== 5) {
    return false;
  }
  const projection: LooseProjection = value;
  return (
    isVersion(projection.head) &&
    projection.head >= 1 &&
    isVersion(projection.honestPrefix) &&
    isVersion(projection.cited) &&
    projection.cited >= 1 &&
    typeof projection.late === "boolean" &&
    isVersion(projection.authority) &&
    projection.authority >= 1
  );
}

function isDevice(value: unknown, devices: readonly string[]): boolean {
  return typeof value === "string" && devices.includes(value);
}

function isStep(value: unknown, devices: readonly string[]): boolean {
  if (!isObject(value)) {
    return false;
  }
  const keys = Object.keys(value).sort().join(",");
  const step: LooseStep = value;
  switch (step.action) {
    case "AdvanceAuthority":
    case "RevokeLateSigner":
      return keys === "action";
    case "CommitDependent":
      return keys === "action,late" && typeof step.late === "boolean";
    case "SyncAuthority":
      return keys === "action,device" && isDevice(step.device, devices);
    case "HonestSync":
      return (
        keys === "action,device,observed" &&
        isDevice(step.device, devices) &&
        isObservedOutcome(step.observed)
      );
    case "Verify":
      return (
        keys === "action,device,observed,projection" &&
        isDevice(step.device, devices) &&
        isObservedOutcome(step.observed) &&
        isProjection(step.projection)
      );
    default:
      return false;
  }
}

/** Fail-closed: a typo or an unknown shape must never reach TLA generation. */
export function parseRecordedTrace(
  name: string,
  raw: string,
): RecordedNoBrickTrace {
  const parsed: unknown = JSON.parse(raw);
  if (!isObject(parsed)) {
    projectionFail(`recorded trace ${name} is malformed.`);
  }
  const trace: LooseTrace = parsed;
  if (
    trace.model !== "NoBrickedDevice" ||
    typeof trace.scenario !== "string" ||
    !isObject(trace.initialCheckpoints) ||
    !Array.isArray(trace.steps)
  ) {
    projectionFail(`recorded trace ${name} is malformed.`);
  }
  const checkpoints = Object.entries(trace.initialCheckpoints);
  const devices = checkpoints.map(([device]) => device);
  if (
    checkpoints.length === 0 ||
    checkpoints.some(
      ([device, checkpoint]) =>
        !DEVICE_PATTERN.test(device) || (checkpoint !== 0 && checkpoint !== 1),
    ) ||
    trace.steps.some((step) => !isStep(step, devices))
  ) {
    projectionFail(`recorded trace ${name} is malformed.`);
  }
  return parsed as RecordedNoBrickTrace;
}

function tla(value: boolean): string {
  return value ? "TRUE" : "FALSE";
}

export function projectionFormula(projection: NoBrickProjection): string {
  return `[head |-> ${projection.head}, honestPrefix |-> ${projection.honestPrefix}, cited |-> ${projection.cited}, late |-> ${tla(projection.late)}, authority |-> ${projection.authority}]`;
}

export function traceStepFormula(step: NoBrickTraceStep): string {
  switch (step.action) {
    case "AdvanceAuthority":
    case "RevokeLateSigner":
      return step.action;
    case "CommitDependent":
      return `CommitDependent(${tla(step.late)})`;
    case "SyncAuthority":
      return `SyncAuthority("${step.device}")`;
    case "HonestSync":
      return `HonestSync("${step.device}") /\\ outcome'["${step.device}"] = "${step.observed.outcome}"`;
    case "Verify": {
      const projection = projectionFormula(step.projection);
      // A served shape the model says no server can produce must fail the
      // trace rather than be verified as if it could; HonestSync covers the
      // honest projection, so Verify leaves the honest-refusal latch alone.
      return `WellFormed(${projection}) /\\ Verify("${step.device}", ${projection}) /\\ UNCHANGED honestRefused /\\ outcome'["${step.device}"] = "${step.observed.outcome}"`;
    }
  }
}

export function traceModuleName(
  trace: RecordedNoBrickTrace,
  suffix: string,
): string {
  return `Trace${trace.scenario
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("")}${suffix}`;
}

/** The bounds a trace needs: every version it advances to or names. */
export function traceBounds(trace: RecordedNoBrickTrace): {
  readonly maxAuthorityVersion: number;
  readonly maxDependentVersion: number;
} {
  let maxAuthorityVersion = 1;
  let maxDependentVersion = 1;
  for (const step of trace.steps) {
    if (
      step.action === "AdvanceAuthority" ||
      step.action === "RevokeLateSigner"
    ) {
      maxAuthorityVersion += 1;
    } else if (step.action === "CommitDependent") {
      maxDependentVersion += 1;
    } else if (step.action === "Verify") {
      maxAuthorityVersion = Math.max(
        maxAuthorityVersion,
        step.projection.authority,
        step.projection.cited,
      );
      maxDependentVersion = Math.max(
        maxDependentVersion,
        step.projection.head,
        step.projection.honestPrefix,
      );
    }
  }
  return { maxAuthorityVersion, maxDependentVersion };
}

export function renderTraceModule(
  name: string,
  trace: RecordedNoBrickTrace,
): { readonly cfg: string; readonly module: string } {
  if (trace.steps.length === 0) {
    projectionFail(`trace ${trace.scenario} records no steps.`);
  }
  const cases = trace.steps
    .map(
      (step, index) =>
        `    ${index === 0 ? "CASE" : "  []"} step = ${index + 1} -> ${traceStepFormula(step)}`,
    )
    .join("\n");
  const devices = Object.keys(trace.initialCheckpoints);
  const initialCheckpoint = devices.reduceRight(
    (rest, device) =>
      `IF d = "${device}" THEN ${trace.initialCheckpoints[device] ?? 0} ELSE ${rest}`,
    "0",
  );
  const bounds = traceBounds(trace);

  const module = `---- MODULE ${name} ----
EXTENDS NoBrickedDevice, Naturals

VARIABLE idx

TraceLen == ${trace.steps.length}

TraceStep(step) ==
${cases}
      [] OTHER -> FALSE

TInit ==
  /\\ Init
  /\\ checkpoint = [d \\in Devices |-> ${initialCheckpoint}]
  /\\ idx = 0

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
  Devices = {${devices.map((device) => `"${device}"`).join(", ")}}
  MaxAuthorityVersion = ${bounds.maxAuthorityVersion}
  MaxDependentVersion = ${bounds.maxDependentVersion}
  ServerHonest = FALSE
  RefuseRollback = TRUE
  RefuseFork = TRUE
  RefuseCitationRegression = TRUE
  RefuseServedAuthorityRollback = TRUE
  RefuseSignerRevokedAtCitation = TRUE
  RefuseSignerRevokedAtCurrent = FALSE
  RefuseStaleHeadCitation = FALSE
  RefuseStaleChainCitation = FALSE

INVARIANT TypeOK
INVARIANT HonestServerNeverRefused
`;
  return { cfg, module };
}
