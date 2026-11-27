import { readFile } from "node:fs/promises";
import type { PhaseMetrics, TestCounts } from "./output";
import type { PayloadAuditSummary } from "./payloadAuditSummary";
import type { RunStatements } from "./runStatements";
import type { PhaseSummary, Range } from "./summary";

/** `unprofiled`: the file passed but printed no request metrics. */
export type CanaryRunStatus = "passed" | "failed" | "timed-out" | "unprofiled";

export type RunPayloadAudit =
  | { readonly status: "off" }
  | { readonly status: "missing"; readonly capture: string }
  | {
      readonly status: "captured";
      readonly capture: string;
      readonly summary: PayloadAuditSummary;
    };

export interface CanaryRun {
  readonly canary: string;
  /** Relative to `packages/app`. */
  readonly file: string;
  /** 1-based. */
  readonly sample: number;
  readonly status: CanaryRunStatus;
  readonly exitCode: number | null;
  readonly wallMs: number;
  readonly tests: TestCounts | null;
  /** The run's complete output, private beside the report. */
  readonly log: string;
  readonly phases: readonly PhaseMetrics[];
  readonly statements: RunStatements;
  readonly payloadAudit?: RunPayloadAudit;
}

export interface CanaryReport {
  readonly schemaVersion: 2;
  readonly scenario: "request-volume-canaries";
  readonly runId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly status: "running" | "complete" | "failed";
  readonly revision: string;
  readonly dirty: boolean;
  readonly runtime: {
    readonly bun: string;
    readonly platform: string;
    readonly arch: string;
    readonly cpu: string | null;
  };
  readonly options: {
    readonly canaries: readonly string[];
    readonly samples: number;
    readonly statements: boolean;
    readonly paramHash: boolean;
    readonly payloadAudit?: boolean;
    readonly stacks?: boolean;
  };
  readonly boundary: string;
  readonly summary: readonly PhaseSummary[];
  readonly runs: readonly CanaryRun[];
}

/**
 * A version 1 report. Reports saved before statement capture (#3336) have
 * none of its fields; later ones keep a run's statements as null or as
 * `{ capture, perPhase }`, with `perPhase` null when unmatched.
 */
interface CanaryReportV1
  extends Omit<CanaryReport, "schemaVersion" | "options" | "summary" | "runs"> {
  readonly schemaVersion: 1;
  readonly options: Omit<CanaryReport["options"], "statements" | "paramHash"> &
    Partial<Pick<CanaryReport["options"], "statements" | "paramHash">>;
  readonly summary: readonly (Omit<PhaseSummary, "statements"> & {
    readonly statements?: Range | null;
  })[];
  readonly runs: readonly (Omit<CanaryRun, "statements"> & {
    readonly statements?: {
      readonly capture: string;
      readonly perPhase: readonly number[] | null;
    } | null;
  })[];
}

export const canaryBoundary =
  "The app, SDK and in-process test API (PGlite, in-memory object store) through the proxied-request recorder; dual-pane canaries sum both panes";

function isSavedReport(value: unknown): value is CanaryReport | CanaryReportV1 {
  if (typeof value !== "object" || value === null) return false;
  const field = (name: string): unknown => Reflect.get(value, name);
  const version = field("schemaVersion");
  const options = field("options");
  return (
    (version === 1 || version === 2) &&
    field("scenario") === "request-volume-canaries" &&
    typeof options === "object" &&
    options !== null &&
    Array.isArray(field("summary")) &&
    Array.isArray(field("runs"))
  );
}

function upgradeRunStatements(
  statements: CanaryReportV1["runs"][number]["statements"],
): RunStatements {
  if (!statements) return { status: "off" };
  const { capture, perPhase } = statements;
  return perPhase === null
    ? { status: "unmatched", capture }
    : { status: "captured", capture, perPhase };
}

/** Fills in every field version 2 declares that a version 1 report lacks. */
function upgradeV1(report: CanaryReportV1): CanaryReport {
  return {
    ...report,
    schemaVersion: 2,
    options: {
      ...report.options,
      statements: report.options.statements ?? false,
      paramHash: report.options.paramHash ?? false,
    },
    summary: report.summary.map((phase) => ({
      ...phase,
      statements: phase.statements ?? null,
    })),
    runs: report.runs.map((run) => ({
      ...run,
      statements: upgradeRunStatements(run.statements),
    })),
  };
}

/**
 * Reads a saved canary report, checking only what a comparison relies on,
 * and upgrades a version 1 report. A report that did not complete is missing
 * canaries, which a comparison would show as removed, so it is refused.
 */
export async function loadCanaryReport(path: string): Promise<CanaryReport> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isSavedReport(value))
    throw new Error(`${path} is not a request-volume canary report.`);
  if (value.status !== "complete")
    throw new Error(
      `${path} is a ${value.status} report; compare only complete ones.`,
    );
  return value.schemaVersion === 1 ? upgradeV1(value) : value;
}
