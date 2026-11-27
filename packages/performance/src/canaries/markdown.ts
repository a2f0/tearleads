import { formatClientSqlMarkdown } from "../statements/clientSqlSummary";
import { formatPayloadAuditMarkdown } from "./payloadMarkdown";
import type { CanaryReport } from "./report";
import {
  type PhaseChange,
  type PhaseSummary,
  phaseChanged,
  type Range,
} from "./summary";

const integers = new Intl.NumberFormat("en-US");

export function formatRange(range: Range): string {
  return range.min === range.max
    ? integers.format(range.min)
    : `${integers.format(range.min)}–${integers.format(range.max)}`;
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|");
}

function phaseName(phase: { label: string; occurrence: number }): string {
  return phase.occurrence === 0
    ? phase.label
    : `${phase.label} (${phase.occurrence + 1})`;
}

/** A Markdown table; `numeric` columns are right-aligned. */
function table(
  header: string[],
  rows: string[][],
  numeric = header.map((_, index) => index > 0),
): string[] {
  const align = header.map((_, index) => (numeric[index] ? "---:" : "---"));
  return [
    `| ${header.join(" | ")} |`,
    `| ${align.join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
}

function phaseTables(phases: readonly PhaseSummary[]): string[] {
  const captured = phases.some((phase) => phase.statements !== null);
  const lines = table(
    [
      "Phase",
      "Requests",
      "Request bytes",
      "Response bytes",
      ...(captured ? ["Statements"] : []),
    ],
    phases.map((phase) => [
      cell(phaseName(phase)),
      formatRange(phase.requests),
      formatRange(phase.requestBytes),
      formatRange(phase.responseBytes),
      ...(captured
        ? [phase.statements ? formatRange(phase.statements) : ""]
        : []),
    ]),
  );
  for (const phase of phases) {
    const endpoints = Object.entries(phase.byRequest).sort(
      ([a, left], [b, right]) =>
        right.count.max - left.count.max || (a < b ? -1 : a > b ? 1 : 0),
    );
    if (endpoints.length === 0) continue;
    lines.push("", `### ${phaseName(phase)}`, "");
    lines.push(
      ...table(
        ["Request", "Count", "Request bytes", "Response bytes"],
        endpoints.map(([request, endpoint]) => [
          `\`${cell(request)}\``,
          formatRange(endpoint.count),
          formatRange(endpoint.requestBytes),
          formatRange(endpoint.responseBytes),
        ]),
      ),
    );
  }
  return lines;
}

function ceilingDriftRow(
  canary: string,
  label: string,
  measuredTotal: number,
  ceilingTotal: number,
): string[] | null {
  const headroom = ceilingTotal - measuredTotal;
  if (headroom <= 0) return null;
  const pctUsed =
    ceilingTotal === 0
      ? "100%"
      : `${Math.round((measuredTotal / ceilingTotal) * 100)}%`;
  return [
    cell(canary),
    cell(label),
    integers.format(measuredTotal),
    integers.format(ceilingTotal),
    integers.format(headroom),
    pctUsed,
  ];
}

function ceilingDriftSection(report: CanaryReport): string[] {
  const rows: string[][] = [];
  const seen = new Set<string>();
  for (const run of report.runs) {
    if (run.status !== "passed") continue;
    for (const phase of run.phases) {
      if (!phase.budget) continue;
      const key = `${run.canary}\0${phase.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = ceilingDriftRow(
        run.canary,
        phase.label,
        phase.budget.measuredTotal,
        phase.budget.ceilingTotal,
      );
      if (row) rows.push(row);
    }
  }
  if (rows.length === 0) return [];
  return [
    "",
    "## Ceiling drift",
    "",
    "Phases whose measured request count is below the ceiling asserted in the canary.",
    "",
    ...table(
      ["Canary", "Phase", "Measured", "Ceiling", "Headroom", "Used"],
      rows,
      [false, false, true, true, true, true],
    ),
  ];
}

function wsHintsSection(report: CanaryReport): string[] {
  const rows: string[][] = [];
  const seen = new Set<string>();
  for (const run of report.runs) {
    if (run.status !== "passed") continue;
    for (const phase of run.phases) {
      if (!phase.ws || phase.ws.total === 0) continue;
      const key = `${run.canary}\0${phase.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const types = Object.entries(phase.ws.byType)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([type, stat]) => `\`${type}\`: ${stat.count}`)
        .join(", ");
      rows.push([
        cell(run.canary),
        cell(phase.label),
        integers.format(phase.ws.total),
        integers.format(phase.ws.bytes),
        (phase.total / phase.ws.total).toFixed(1),
        types,
      ]);
    }
  }
  if (rows.length === 0) return [];
  return [
    "",
    "## WebSocket hints",
    "",
    "Delivered server-to-client WebSocket frames per phase and HTTP requests issued per frame.",
    "",
    ...table(
      ["Canary", "Phase", "Frames", "Bytes", "HTTP / frame", "By type"],
      rows,
      [false, false, true, true, true, false],
    ),
  ];
}

function clientSqlSection(report: CanaryReport): string[] {
  const lines: string[] = [];
  for (const run of report.runs) {
    if (run.status !== "passed" || run.clientSql?.status !== "captured")
      continue;
    lines.push(
      ...formatClientSqlMarkdown(
        `Client SQLite: ${run.canary} (#${run.sample})`,
        run.clientSql.summary,
      ),
    );
  }
  return lines;
}

function payloadAuditSection(report: CanaryReport): string[] {
  const lines: string[] = [];
  for (const run of report.runs) {
    if (run.status !== "passed" || run.payloadAudit?.status !== "captured")
      continue;
    lines.push(
      ...formatPayloadAuditMarkdown(
        `Payload audit: ${run.canary} (#${run.sample})`,
        run.payloadAudit.summary,
      ),
    );
  }
  return lines;
}

/** The baseline an audit saves and an issue reproduces. */
export function formatCanaryReport(report: CanaryReport): string {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const lines = [
    "# Request-volume canaries",
    "",
    `Revision \`${report.revision}\`${report.dirty ? " with uncommitted changes" : ""}, ` +
      `Bun ${report.runtime.bun} on ${report.runtime.cpu ?? report.runtime.arch}, ` +
      `${report.options.samples} sample${report.options.samples === 1 ? "" : "s"} per canary, ` +
      `started ${report.startedAt}. ${report.boundary}. ` +
      "A range is the lowest and highest value across samples.",
    "",
    ...table(
      ["Canary", "Sample", "Status", "Tests", "Wall time"],
      report.runs.map((run) => [
        run.canary,
        `${run.sample}`,
        run.status,
        run.tests ? `${run.tests.pass} pass, ${run.tests.fail} fail` : "none",
        seconds(run.wallMs),
      ]),
      [false, true, false, false, true],
    ),
  ];
  const canaries = [...new Set(report.summary.map((phase) => phase.canary))];
  for (const canary of canaries) {
    lines.push("", `## ${canary}`, "");
    lines.push(
      ...phaseTables(report.summary.filter((phase) => phase.canary === canary)),
    );
  }
  lines.push(
    ...ceilingDriftSection(report),
    ...wsHintsSection(report),
    ...clientSqlSection(report),
    ...payloadAuditSection(report),
  );
  return `${lines.join("\n")}\n`;
}

/** A change in the lowest value, beside both ranges when they differ. */
function delta(before: Range | undefined, after: Range | undefined): string {
  if (!before) return after ? `new: ${formatRange(after)}` : "";
  if (!after) return `${formatRange(before)} → removed`;
  const change = after.min - before.min;
  if (change === 0)
    return before.max === after.max
      ? formatRange(after)
      : `${formatRange(before)} → ${formatRange(after)}`;
  const sign = change > 0 ? "+" : "";
  return `${formatRange(before)} → ${formatRange(after)} (${sign}${integers.format(change)})`;
}

/**
 * A phase both reports have compares statements only when both captured
 * them; otherwise the cell would read as the phase appearing or vanishing.
 */
function statementsDelta(change: PhaseChange): string {
  const { before, after } = change;
  if (before && after)
    return before.statements && after.statements
      ? delta(before.statements, after.statements)
      : "";
  return delta(before?.statements ?? undefined, after?.statements ?? undefined);
}

/** The phases and endpoints that differ between two reports. */
export function formatComparison(
  changes: readonly PhaseChange[],
  identities: { before: string; after: string },
): string {
  const changed = changes.filter(phaseChanged);
  const lines = [
    `# Canary comparison`,
    "",
    `Before: ${identities.before}. After: ${identities.after}. ` +
      `${changed.length} of ${changes.length} phases changed. ` +
      "Deltas compare the lowest values.",
  ];
  if (changed.length === 0) return `${lines.join("\n")}\n`;
  const captured = changed.some(
    (change) => change.before?.statements || change.after?.statements,
  );
  lines.push(
    "",
    ...table(
      [
        "Canary",
        "Phase",
        "Requests",
        "Request bytes",
        "Response bytes",
        ...(captured ? ["Statements"] : []),
      ],
      changed.map((change) => [
        change.canary,
        cell(phaseName(change)),
        delta(change.before?.requests, change.after?.requests),
        delta(change.before?.requestBytes, change.after?.requestBytes),
        delta(change.before?.responseBytes, change.after?.responseBytes),
        ...(captured ? [statementsDelta(change)] : []),
      ]),
      [false, false, true, true, true, true],
    ),
  );
  for (const change of changed) {
    // A phase only one report has is summarized by its row above.
    if (!change.before || !change.after || change.endpoints.length === 0)
      continue;
    lines.push("", `## ${change.canary}: ${phaseName(change)}`, "");
    lines.push(
      ...table(
        ["Request", "Count", "Request bytes", "Response bytes"],
        change.endpoints.map((endpoint) => [
          `\`${cell(endpoint.request)}\``,
          delta(endpoint.before.count, endpoint.after.count),
          delta(endpoint.before.requestBytes, endpoint.after.requestBytes),
          delta(endpoint.before.responseBytes, endpoint.after.responseBytes),
        ]),
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}
