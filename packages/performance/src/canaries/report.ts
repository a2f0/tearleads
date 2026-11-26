import { readFile } from "node:fs/promises";
import type { PhaseMetrics, TestCounts } from "./output";
import type { PhaseSummary } from "./summary";

/** `unprofiled`: the file passed but printed no request metrics. */
export type CanaryRunStatus = "passed" | "failed" | "timed-out" | "unprofiled";

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
}

export interface CanaryReport {
  readonly schemaVersion: 1;
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
  };
  readonly boundary: string;
  readonly summary: readonly PhaseSummary[];
  readonly runs: readonly CanaryRun[];
}

export const canaryBoundary =
  "The app, SDK and in-process test API (PGlite, in-memory object store) through the proxied-request recorder; dual-pane canaries sum both panes";

function isCanaryReport(value: unknown): value is CanaryReport {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "schemaVersion") === 1 &&
    Reflect.get(value, "scenario") === "request-volume-canaries" &&
    Array.isArray(Reflect.get(value, "summary")) &&
    Array.isArray(Reflect.get(value, "runs"))
  );
}

/** Reads a saved canary report, checking only what a comparison relies on. */
export async function loadCanaryReport(path: string): Promise<CanaryReport> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isCanaryReport(value))
    throw new Error(`${path} is not a request-volume canary report.`);
  return value;
}
