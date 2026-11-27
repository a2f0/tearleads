import { median } from "../median";
import type {
  BaselineMode,
  BaselinePhaseMeasurement,
  BaselinePhaseName,
} from "./runTier";

const integers = new Intl.NumberFormat("en-US");
const MEBIBYTE = 1024 * 1024;

export interface BaselineSummaryRow {
  readonly phase: BaselinePhaseName;
  readonly sizeMiB: number;
  readonly race: boolean;
  readonly samples: number;
  readonly baselineMode: BaselineMode | null;
  readonly maxStagedSegments: number;
  readonly maxStageResumes: number;
  readonly medianWallMs: number;
  readonly medianRequests: number;
  readonly maxConflicts: number;
  readonly medianRequestBytes: number;
  readonly medianResponseBytes: number;
  readonly medianPgStatements: number;
  readonly medianPgRoundTrips: number;
  readonly medianLocalSqlCalls: number;
  readonly peakRssDeltaMiB: number;
  readonly maxPlanWarnings: number;
}

const phaseOrder: readonly BaselinePhaseName[] = [
  "seed-history",
  "first-unlink-rotate",
  "fresh-reader-sync",
  "second-unlink-rotate",
];

function countPlanWarnings(measurement: BaselinePhaseMeasurement): number {
  const top = measurement.localSql?.attribution?.top ?? [];
  return top.reduce((sum, entry) => sum + (entry.planFlags?.length ?? 0), 0);
}

/** One compact terminal progress line per measured baseline phase. */
export function formatBaselineLine(m: BaselinePhaseMeasurement): string {
  const modeNote =
    m.baselineMode !== undefined
      ? ` [${m.baselineMode}${m.stagedSegments ? `, ${m.stagedSegments} segs` : ""}${m.stageResumes ? `, ${m.stageResumes} resume` : ""}]`
      : "";
  const parts = [
    `${m.sizeMiB}MiB${m.race ? "+race" : ""} #${m.sample}`,
    `${m.phase}${modeNote}`,
    `${m.http.requests} reqs` +
      (m.http.conflicts > 0 ? ` (${m.http.conflicts} 409s)` : ""),
    `${m.database.statements} pg stmts`,
    ...(m.localSql ? [`${m.localSql.calls} local SQL`] : []),
    `${m.wallMs} ms`,
    `+${(m.resources.peakRssDeltaBytes / MEBIBYTE).toFixed(1)} MiB RSS`,
  ];
  return parts.join(", ");
}

/** Groups measurements by `(phase, sizeMiB, race)` ordered by phase then size. */
export function summarizeBaselines(
  measurements: readonly BaselinePhaseMeasurement[],
): BaselineSummaryRow[] {
  const groups = new Map<string, BaselinePhaseMeasurement[]>();
  for (const item of measurements) {
    const key = `${item.phase}:${item.sizeMiB}:${item.race}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()]
    .flatMap((group) => {
      const [first] = group;
      if (!first) return [];
      const mode = group.some((m) => m.baselineMode === "staged")
        ? "staged"
        : (first.baselineMode ?? null);
      return [
        {
          phase: first.phase,
          sizeMiB: first.sizeMiB,
          race: first.race,
          samples: group.length,
          baselineMode: mode,
          maxStagedSegments: Math.max(
            0,
            ...group.map((m) => m.stagedSegments ?? 0),
          ),
          maxStageResumes: Math.max(
            0,
            ...group.map((m) => m.stageResumes ?? 0),
          ),
          medianWallMs: median(group.map((m) => m.wallMs)),
          medianRequests: median(group.map((m) => m.http.requests)),
          maxConflicts: Math.max(...group.map((m) => m.http.conflicts)),
          medianRequestBytes: median(group.map((m) => m.http.requestBytes)),
          medianResponseBytes: median(group.map((m) => m.http.responseBytes)),
          medianPgStatements: median(group.map((m) => m.database.statements)),
          medianPgRoundTrips: median(group.map((m) => m.database.roundTrips)),
          medianLocalSqlCalls: median(group.map((m) => m.localSql?.calls ?? 0)),
          peakRssDeltaMiB:
            Math.max(...group.map((m) => m.resources.peakRssDeltaBytes)) /
            MEBIBYTE,
          maxPlanWarnings: Math.max(...group.map(countPlanWarnings)),
        },
      ];
    })
    .sort(
      (a, b) =>
        phaseOrder.indexOf(a.phase) - phaseOrder.indexOf(b.phase) ||
        a.sizeMiB - b.sizeMiB ||
        Number(a.race) - Number(b.race),
    );
}

/** Formats a Markdown scaling summary for `perf:baselines`. */
export function formatBaselinesMarkdown(
  summary: readonly BaselineSummaryRow[],
  intro: string,
): string {
  const lines = [
    "# Rotation baseline scaling",
    "",
    intro,
    "",
    "| Phase | Size MiB | Race | Mode | Staged segs | Wall ms | Reqs | 409s | Req B | Resp B | PG stmts | Local SQL | Peak RSS MiB | Plan flags |",
    "| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...summary.map((row) => {
      const modeCell = row.baselineMode ?? "—";
      const segsCell =
        row.baselineMode !== null
          ? `${integers.format(row.maxStagedSegments)}${row.maxStageResumes > 0 ? ` (+${row.maxStageResumes}r)` : ""}`
          : "—";
      return `| \`${row.phase}\` | ${row.sizeMiB} | ${row.race ? "yes" : "no"} | ${modeCell} | ${segsCell} | ${integers.format(row.medianWallMs)} | ${integers.format(row.medianRequests)} | ${integers.format(row.maxConflicts)} | ${integers.format(row.medianRequestBytes)} | ${integers.format(row.medianResponseBytes)} | ${integers.format(row.medianPgStatements)} | ${integers.format(row.medianLocalSqlCalls)} | ${row.peakRssDeltaMiB.toFixed(1)} | ${row.maxPlanWarnings} |`;
    }),
  ];
  return `${lines.join("\n")}\n`;
}
