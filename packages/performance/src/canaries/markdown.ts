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
