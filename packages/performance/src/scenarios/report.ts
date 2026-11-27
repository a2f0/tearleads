import { readFile } from "node:fs/promises";
import type { TestCounts } from "../canaries/output";
import type { RunClientSql, RunPayloadAudit } from "../canaries/report";
import type { StatementSummary } from "../statements/summary";
import type { ScenarioHttpSummary } from "./httpCapture";
import type { ScenarioSummary } from "./summary";

export type ScenarioRunStatus =
  | "passed"
  | "failed"
  | "timed-out"
  | "unprofiled";

export type RunScenarioStatements =
  | { readonly status: "off" }
  | { readonly status: "missing"; readonly capture: string }
  | {
      readonly status: "captured";
      readonly capture: string;
      readonly summary: StatementSummary;
    };

export interface ScenarioRun {
  readonly scenario: string;
  /** Relative to `packages/bob-and-alice`. */
  readonly file: string;
  /** 1-based. */
  readonly sample: number;
  readonly status: ScenarioRunStatus;
  readonly exitCode: number | null;
  readonly wallMs: number;
  readonly tests: TestCounts | null;
  readonly log: string;
  readonly httpCapture: string;
  readonly http: ScenarioHttpSummary | null;
  readonly statements: RunScenarioStatements;
  readonly clientSql?: RunClientSql;
  readonly payloadAudit?: RunPayloadAudit;
}

export interface ScenarioReport {
  readonly schemaVersion: 1;
  readonly scenario: "bob-and-alice-scenarios";
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
    readonly scenarios: readonly string[];
    readonly samples: number;
    readonly statements: boolean;
    readonly paramHash: boolean;
    readonly clientStatements: boolean;
    readonly payloadAudit: boolean;
    readonly stacks: boolean;
  };
  readonly boundary: string;
  readonly summary: readonly ScenarioSummary[];
  readonly runs: readonly ScenarioRun[];
}

export const scenarioBoundary =
  "Multi-party bob-and-alice scenarios running real Tearleads SDK installs (in-memory SQLite + device HTTP proxies) against the in-process API (PGlite by default, no realtime hints)";

function isSavedScenarioReport(value: unknown): value is ScenarioReport {
  if (typeof value !== "object" || value === null) return false;
  const status: unknown = Reflect.get(value, "status");
  return (
    Reflect.get(value, "schemaVersion") === 1 &&
    Reflect.get(value, "scenario") === "bob-and-alice-scenarios" &&
    typeof Reflect.get(value, "runId") === "string" &&
    typeof Reflect.get(value, "revision") === "string" &&
    (status === "running" || status === "complete" || status === "failed") &&
    Array.isArray(Reflect.get(value, "summary")) &&
    Array.isArray(Reflect.get(value, "runs"))
  );
}

export async function loadScenarioReport(
  path: string,
): Promise<ScenarioReport> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isSavedScenarioReport(value)) {
    throw new Error(`${path} is not a bob-and-alice scenario report.`);
  }
  if (value.status !== "complete") {
    throw new Error(
      `${path} is a ${value.status} report; compare only complete ones.`,
    );
  }
  return value;
}
