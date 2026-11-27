import type { EpochSnapshot } from "./schema";

const integers = new Intl.NumberFormat("en-US");

export function fmtNum(value: number): string {
  return Number.isInteger(value)
    ? integers.format(value)
    : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function fmtMaybeNum(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : fmtNum(value);
}

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|").replace(/\s*\n\s*/gu, " ");
}

export function formatMarkdownTable(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  numeric: readonly boolean[],
): string[] {
  const align = header.map((_, index) => (numeric[index] ? "---:" : "---"));
  return [
    `| ${header.map(escapeCell).join(" | ")} |`,
    `| ${align.join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ];
}

function renderCanaryBreakdown(latest: EpochSnapshot): string[] {
  if (!latest.canaries) return [];
  return [
    "",
    "## Latest Per-Canary Breakdown",
    "",
    ...formatMarkdownTable(
      [
        "Canary",
        "Reqs",
        "Req B",
        "Res B",
        "Redundant B",
        "Head Re-reads",
        "API Stmts",
        "Pure Repeats",
        "Client SQL",
      ],
      latest.canaries.byCanary.map((item) => [
        `\`${item.canary}\``,
        fmtMaybeNum(item.requests),
        fmtMaybeNum(item.requestBytes),
        fmtMaybeNum(item.responseBytes),
        fmtMaybeNum(item.redundantBytes),
        fmtMaybeNum(item.exactHeadRereads),
        fmtMaybeNum(item.apiStatements),
        fmtMaybeNum(item.apiPureReadRepeats),
        fmtMaybeNum(item.clientSqlStatements),
      ]),
      [false, true, true, true, true, true, true, true, true],
    ),
  ];
}

function renderScenarioBreakdown(latest: EpochSnapshot): string[] {
  if (!latest.scenarios) return [];
  return [
    "",
    "## Latest Multi-Party Scenarios (`bob-and-alice`)",
    "",
    ...formatMarkdownTable(
      [
        "Scenario",
        "Reqs",
        "409s",
        "Req B",
        "Res B",
        "API Stmts",
        "Pure Repeats",
        "Client SQL",
      ],
      latest.scenarios.byScenario.map((item) => [
        `\`${item.scenario}\``,
        fmtNum(item.requests),
        fmtNum(item.conflicts),
        fmtNum(item.requestBytes),
        fmtNum(item.responseBytes),
        fmtMaybeNum(item.apiStatements),
        fmtMaybeNum(item.pureReadRepeats),
        fmtMaybeNum(item.clientSqlStatements),
      ]),
      [false, true, true, true, true, true, true, true],
    ),
  ];
}

function renderProbeBreakdowns(latest: EpochSnapshot): string[] {
  const lines: string[] = [];
  if (latest.reload && latest.reload.length > 0) {
    lines.push(
      "",
      "## Latest Reload Scaling",
      "",
      ...formatMarkdownTable(
        [
          "Docs",
          "Folders",
          "Reload",
          "Reqs",
          "Settled ms",
          "API Stmts",
          "Client SQL",
        ],
        latest.reload.map((row) => [
          fmtNum(row.documents),
          fmtNum(row.folders),
          row.reload,
          fmtNum(row.medianRequests),
          fmtNum(row.medianSettledMs),
          fmtNum(row.medianApiStatements),
          fmtNum(row.medianClientStatements),
        ]),
        [true, true, false, true, true, true, true],
      ),
    );
  }
  if (latest.realtime && latest.realtime.length > 0) {
    lines.push(
      "",
      "## Latest Realtime Hub Scaling",
      "",
      ...formatMarkdownTable(
        [
          "Folders",
          "Pass",
          "Median ms",
          "CPU ms",
          "PG Stmts",
          "Rows",
          "PG Bytes",
        ],
        latest.realtime.map((row) => [
          fmtNum(row.size),
          row.pass,
          fmtNum(row.medianDurationMs),
          fmtNum(row.medianCpuMs),
          fmtNum(row.statements),
          fmtNum(row.rows),
          fmtNum(row.bytesReturned),
        ]),
        [true, false, true, true, true, true, true],
      ),
    );
  }
  return lines;
}

function renderScalingProbeTables(latest: EpochSnapshot): string[] {
  const lines: string[] = [];
  if (latest.rotations && latest.rotations.length > 0) {
    lines.push(
      "",
      "## Latest Rotation & Revocation Scaling",
      "",
      ...formatMarkdownTable(
        [
          "Phase",
          "Rotations",
          "Depth",
          "Reqs",
          "409s",
          "PG Stmts",
          "Local SQL",
          "Wall ms",
        ],
        latest.rotations.map((row) => [
          `\`${row.phase}\``,
          fmtNum(row.rotations),
          fmtNum(row.depth),
          fmtNum(row.medianRequests),
          fmtNum(row.maxConflicts),
          fmtNum(row.medianPgStatements),
          fmtNum(row.medianLocalSqlCalls),
          fmtNum(row.medianWallMs),
        ]),
        [false, true, true, true, true, true, true, true],
      ),
    );
  }
  if (latest.baselines && latest.baselines.length > 0) {
    lines.push(
      "",
      "## Latest Rotation Baseline Scaling",
      "",
      ...formatMarkdownTable(
        [
          "Phase",
          "MiB",
          "Race",
          "Mode",
          "Reqs",
          "PG Stmts",
          "Local SQL",
          "Peak RSS MiB",
        ],
        latest.baselines.map((row) => [
          `\`${row.phase}\``,
          fmtNum(row.sizeMiB),
          row.race ? "yes" : "no",
          row.baselineMode ?? "—",
          fmtNum(row.medianRequests),
          fmtNum(row.medianPgStatements),
          fmtNum(row.medianLocalSqlCalls),
          fmtNum(row.peakRssDeltaMiB),
        ]),
        [false, true, false, false, true, true, true, true],
      ),
    );
  }
  return lines;
}

/** Renders the latest snapshot's per-canary, scenario, and probe tables. */
export function renderLatestBreakdowns(latest: EpochSnapshot): string[] {
  return [
    ...renderCanaryBreakdown(latest),
    ...renderScenarioBreakdown(latest),
    ...renderProbeBreakdowns(latest),
    ...renderScalingProbeTables(latest),
  ];
}
