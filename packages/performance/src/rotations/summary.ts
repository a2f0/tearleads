import { median } from "../median";
import type { RotationPhaseMeasurement, RotationPhaseName } from "./runTier";

const integers = new Intl.NumberFormat("en-US");

export interface RotationSummaryRow {
  readonly phase: RotationPhaseName;
  readonly rotations: number;
  readonly depth: number;
  readonly samples: number;
  readonly medianWallMs: number;
  readonly medianRequests: number;
  readonly maxConflicts: number;
  readonly medianRequestBytes: number;
  readonly medianResponseBytes: number;
  readonly medianPgStatements: number;
  readonly medianPgRoundTrips: number;
  readonly medianPgBytesReturned: number;
  readonly medianLocalSqlCalls: number;
  readonly medianCpuMs: number;
  readonly maxPlanWarnings: number;
}

function countPlanWarnings(measurement: RotationPhaseMeasurement): number {
  const top = measurement.localSql?.attribution?.top ?? [];
  return top.reduce((sum, entry) => sum + (entry.planFlags?.length ?? 0), 0);
}

/** One compact terminal line per measured rotation phase. */
export function formatRotationLine(m: RotationPhaseMeasurement): string {
  const parts = [
    `R=${m.rotations} D=${m.depth} #${m.sample}`,
    m.phase,
    `${m.http.requests} reqs` +
      (m.http.conflicts > 0 ? ` (${m.http.conflicts} 409s)` : ""),
    `${m.database.statements} pg stmts`,
    ...(m.localSql ? [`${m.localSql.calls} local SQL`] : []),
    `${m.wallMs} ms`,
  ];
  return parts.join(", ");
}

const phaseOrder: readonly RotationPhaseName[] = [
  "group-share",
  "group-shrink",
  "stale-writer-repair",
  "direct-revoke",
  "grantee-subtree-repair",
  "subtree-move",
  "fresh-reader-hydration",
  "roster-vouched-share",
];

/** Medians grouped by `(phase, rotations)` ordered by phase then ascending rotations. */
export function summarizeRotations(
  measurements: readonly RotationPhaseMeasurement[],
): RotationSummaryRow[] {
  const groups = new Map<string, RotationPhaseMeasurement[]>();
  for (const item of measurements) {
    const key = `${item.phase}:${item.rotations}:${item.depth}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()]
    .flatMap((group) => {
      const [first] = group;
      if (!first) return [];
      return [
        {
          phase: first.phase,
          rotations: first.rotations,
          depth: first.depth,
          samples: group.length,
          medianWallMs: median(group.map((m) => m.wallMs)),
          medianRequests: median(group.map((m) => m.http.requests)),
          maxConflicts: Math.max(...group.map((m) => m.http.conflicts)),
          medianRequestBytes: median(group.map((m) => m.http.requestBytes)),
          medianResponseBytes: median(group.map((m) => m.http.responseBytes)),
          medianPgStatements: median(group.map((m) => m.database.statements)),
          medianPgRoundTrips: median(group.map((m) => m.database.roundTrips)),
          medianPgBytesReturned: median(
            group.map((m) => m.database.bytesReturned),
          ),
          medianLocalSqlCalls: median(group.map((m) => m.localSql?.calls ?? 0)),
          medianCpuMs: median(group.map((m) => m.resources.cpuMs)),
          maxPlanWarnings: Math.max(...group.map(countPlanWarnings)),
        },
      ];
    })
    .sort(
      (a, b) =>
        phaseOrder.indexOf(a.phase) - phaseOrder.indexOf(b.phase) ||
        a.rotations - b.rotations ||
        a.depth - b.depth,
    );
}

/** Formats a Markdown scaling summary for `perf:rotations`. */
export function formatRotationsMarkdown(
  summary: readonly RotationSummaryRow[],
  intro: string,
): string {
  const lines = [
    "# Key rotation and revocation scaling",
    "",
    intro,
    "",
    "| Phase | Rotations | Depth | Wall ms | Reqs | 409s | Req B | Resp B | PG stmts | PG trips | Local SQL | CPU ms | Plan flags |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...summary.map(
      (row) =>
        `| \`${row.phase}\` | ${row.rotations} | ${row.depth} | ${integers.format(row.medianWallMs)} | ${integers.format(row.medianRequests)} | ${integers.format(row.maxConflicts)} | ${integers.format(row.medianRequestBytes)} | ${integers.format(row.medianResponseBytes)} | ${integers.format(row.medianPgStatements)} | ${integers.format(row.medianPgRoundTrips)} | ${integers.format(row.medianLocalSqlCalls)} | ${row.medianCpuMs.toFixed(1)} | ${row.maxPlanWarnings} |`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}
