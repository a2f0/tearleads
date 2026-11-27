import { formatRange } from "../canaries/markdown";
import { formatPayloadAuditMarkdown } from "../canaries/payloadMarkdown";
import type { Range } from "../canaries/summary";
import { formatClientSqlMarkdown } from "../statements/clientSqlSummary";
import type { StatementSummary } from "../statements/summary";
import type { ScenarioReport } from "./report";
import {
  type ScenarioChange,
  type ScenarioSummary,
  scenarioChanged,
} from "./summary";

const integers = new Intl.NumberFormat("en-US");

function cell(text: string): string {
  return text.replaceAll("|", "\\|");
}

function secondsRange(ms: Range): string {
  const low = (ms.min / 1000).toFixed(1);
  const high = (ms.max / 1000).toFixed(1);
  return low === high ? `${low} s` : `${low}–${high} s`;
}

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

function formatCountsMap(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "";
  return entries
    .slice(0, 8)
    .map(([name, count]) => `\`${cell(name)}\`: ${integers.format(count)}`)
    .join(", ");
}

function overviewTable(summary: readonly ScenarioSummary[]): string[] {
  const hasApiSql = summary.some((item) => item.apiStatements !== null);
  const hasRepeats = summary.some((item) => item.pureReadRepeats !== null);
  const hasClientSql = summary.some((item) => item.clientStatements !== null);
  const header = [
    "Scenario",
    "Wall time",
    "Requests",
    "409s",
    "Request bytes",
    "Response bytes",
    ...(hasApiSql ? ["API stmts"] : []),
    ...(hasRepeats ? ["Pure repeats"] : []),
    ...(hasClientSql ? ["Client SQL"] : []),
  ];
  return table(
    header,
    summary.map((item) => [
      `\`${cell(item.scenario)}\``,
      secondsRange(item.wallMs),
      formatRange(item.requests),
      formatRange(item.conflicts),
      formatRange(item.requestBytes),
      formatRange(item.responseBytes),
      ...(hasApiSql
        ? [item.apiStatements ? formatRange(item.apiStatements) : ""]
        : []),
      ...(hasRepeats
        ? [item.pureReadRepeats ? formatRange(item.pureReadRepeats) : ""]
        : []),
      ...(hasClientSql
        ? [item.clientStatements ? formatRange(item.clientStatements) : ""]
        : []),
    ]),
  );
}

function scenarioDetailSection(item: ScenarioSummary): string[] {
  const lines = ["", `## ${item.scenario}`, ""];
  const ops = formatCountsMap(item.operations);
  if (ops) lines.push(`Operations: ${ops}.`);
  const codes = formatCountsMap(item.errorCodes);
  if (codes) lines.push(`Error codes: ${codes}.`);
  if (ops || codes) lines.push("");
  const routes = Object.entries(item.byRoute).sort(
    ([aRoute, a], [bRoute, b]) =>
      b.count.max - a.count.max ||
      b.responseBytes.max +
        b.requestBytes.max -
        (a.responseBytes.max + a.requestBytes.max) ||
      (aRoute < bRoute ? -1 : aRoute > bRoute ? 1 : 0),
  );
  if (routes.length > 0) {
    lines.push(
      ...table(
        ["Route", "Count", "409s", "Request bytes", "Response bytes"],
        routes.map(([route, stat]) => [
          `\`${cell(route)}\``,
          formatRange(stat.count),
          formatRange(stat.conflicts),
          formatRange(stat.requestBytes),
          formatRange(stat.responseBytes),
        ]),
      ),
    );
  }
  return lines;
}

function apiStatementsRows(summary: StatementSummary): string[] {
  if (summary.routes.length > 0) {
    return table(
      [
        "Route",
        "Reqs",
        "Stmts",
        "Per req",
        "Max",
        "In tx",
        ...(summary.paramHashes ? ["Pure repeats", "All repeats"] : []),
      ],
      summary.routes
        .slice(0, 15)
        .map((route) => [
          `\`${cell(route.route)}\``,
          integers.format(route.requests),
          integers.format(route.statements),
          route.requests === 0
            ? ""
            : (route.statements / route.requests).toFixed(1),
          integers.format(route.maxPerRequest),
          integers.format(route.txStatements),
          ...(summary.paramHashes
            ? [
                integers.format(route.pureReadRepeats ?? 0),
                integers.format(route.sameKeyRepeats ?? 0),
              ]
            : []),
        ]),
    );
  }
  return table(
    [
      "Label",
      "Stmts",
      "Scopes",
      ...(summary.paramHashes ? ["Pure repeats"] : []),
    ],
    summary.labels
      .slice(0, 15)
      .map((label) => [
        `\`${cell(label.label)}\``,
        integers.format(label.statements),
        integers.format(label.requestScopes),
        ...(summary.paramHashes
          ? [
              integers.format(
                (label.pureReadRepeats ?? []).reduce(
                  (sum, item) => sum + item.count,
                  0,
                ),
              ),
            ]
          : []),
      ]),
  );
}

function apiStatementsSection(report: ScenarioReport): string[] {
  const lines: string[] = [];
  for (const run of report.runs) {
    if (run.status !== "passed" || run.statements.status !== "captured") {
      continue;
    }
    const { summary } = run.statements;
    if (summary.routes.length === 0 && summary.labels.length === 0) continue;
    lines.push(
      "",
      `## API statements: ${run.scenario} (#${run.sample})`,
      "",
      `${integers.format(summary.statements)} API ORM statements (${integers.format(summary.txStatements)} in ${integers.format(summary.transactions)} transactions, ${integers.format(summary.lockHoldStatements)} under locks).`,
      ...(summary.truncated
        ? [
            "",
            "Capture reached its record limit; API statement counts are lower bounds.",
          ]
        : []),
      "",
      ...apiStatementsRows(summary),
    );
  }
  return lines;
}

function clientSqlSection(report: ScenarioReport): string[] {
  const lines: string[] = [];
  for (const run of report.runs) {
    if (run.status !== "passed" || run.clientSql?.status !== "captured") {
      continue;
    }
    lines.push(
      ...formatClientSqlMarkdown(
        `Client SQLite: ${run.scenario} (#${run.sample})`,
        run.clientSql.summary,
      ),
    );
  }
  return lines;
}

function payloadAuditSection(report: ScenarioReport): string[] {
  const lines: string[] = [];
  for (const run of report.runs) {
    if (run.status !== "passed" || run.payloadAudit?.status !== "captured") {
      continue;
    }
    lines.push(
      ...formatPayloadAuditMarkdown(
        `Payload audit: ${run.scenario} (#${run.sample})`,
        run.payloadAudit.summary,
      ),
    );
  }
  return lines;
}

/** Formats a complete bob-and-alice scenario profile report as Markdown. */
export function formatScenarioReport(report: ScenarioReport): string {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const lines = [
    "# Multi-party bob-and-alice scenarios",
    "",
    `Revision \`${report.revision}\`${report.dirty ? " with uncommitted changes" : ""}, ` +
      `Bun ${report.runtime.bun} on ${report.runtime.cpu ?? report.runtime.arch}, ` +
      `${report.options.samples} sample${report.options.samples === 1 ? "" : "s"} per scenario, ` +
      `started ${report.startedAt}. ${report.boundary}.`,
    "",
    ...table(
      ["Scenario", "Sample", "Status", "Tests", "Wall time"],
      report.runs.map((run) => [
        `\`${cell(run.scenario)}\``,
        `${run.sample}`,
        run.status,
        run.tests ? `${run.tests.pass} pass, ${run.tests.fail} fail` : "none",
        seconds(run.wallMs),
      ]),
      [false, true, false, false, true],
    ),
  ];
  const truncatedRuns = report.runs.filter(
    (run) =>
      run.http?.truncated ||
      (run.statements.status === "captured" &&
        run.statements.summary.truncated) ||
      (run.clientSql?.status === "captured" && run.clientSql.summary.truncated),
  );
  if (truncatedRuns.length > 0) {
    lines.push(
      "",
      `Warning: capture limit reached for ${truncatedRuns.map((run) => `\`${cell(run.scenario)}\` (#${run.sample})`).join(", ")}; counts are lower bounds.`,
    );
  }
  if (report.summary.length > 0) {
    lines.push("", "## Summary", "", ...overviewTable(report.summary));
    for (const item of report.summary) {
      lines.push(...scenarioDetailSection(item));
    }
  }
  lines.push(
    ...apiStatementsSection(report),
    ...clientSqlSection(report),
    ...payloadAuditSection(report),
  );
  return `${lines.join("\n")}\n`;
}

function delta(before: Range | undefined, after: Range | undefined): string {
  if (!before) return after ? `new: ${formatRange(after)}` : "";
  if (!after) return `${formatRange(before)} → removed`;
  const change = after.min - before.min;
  if (change === 0) {
    return before.max === after.max
      ? formatRange(after)
      : `${formatRange(before)} → ${formatRange(after)}`;
  }
  const sign = change > 0 ? "+" : "";
  return `${formatRange(before)} → ${formatRange(after)} (${sign}${integers.format(change)})`;
}

function optionalDelta(
  before: Range | null | undefined,
  after: Range | null | undefined,
  bothPresent: boolean,
): string {
  if (bothPresent) return before && after ? delta(before, after) : "";
  return delta(before ?? undefined, after ?? undefined);
}

function comparisonOverviewTable(changed: readonly ScenarioChange[]): string[] {
  const hasApi = changed.some(
    (item) => item.before?.apiStatements || item.after?.apiStatements,
  );
  const hasRepeats = changed.some(
    (item) => item.before?.pureReadRepeats || item.after?.pureReadRepeats,
  );
  const hasClient = changed.some(
    (item) => item.before?.clientStatements || item.after?.clientStatements,
  );
  return table(
    [
      "Scenario",
      "Requests",
      "409s",
      "Request bytes",
      "Response bytes",
      ...(hasApi ? ["API stmts"] : []),
      ...(hasRepeats ? ["Pure repeats"] : []),
      ...(hasClient ? ["Client SQL"] : []),
    ],
    changed.map((item) => {
      const both = Boolean(item.before && item.after);
      return [
        `\`${cell(item.scenario)}\``,
        delta(item.before?.requests, item.after?.requests),
        delta(item.before?.conflicts, item.after?.conflicts),
        delta(item.before?.requestBytes, item.after?.requestBytes),
        delta(item.before?.responseBytes, item.after?.responseBytes),
        ...(hasApi
          ? [
              optionalDelta(
                item.before?.apiStatements,
                item.after?.apiStatements,
                both,
              ),
            ]
          : []),
        ...(hasRepeats
          ? [
              optionalDelta(
                item.before?.pureReadRepeats,
                item.after?.pureReadRepeats,
                both,
              ),
            ]
          : []),
        ...(hasClient
          ? [
              optionalDelta(
                item.before?.clientStatements,
                item.after?.clientStatements,
                both,
              ),
            ]
          : []),
      ];
    }),
  );
}

/** Formats changes between two saved scenario reports. */
export function formatScenarioComparison(
  changes: readonly ScenarioChange[],
  identities: { readonly before: string; readonly after: string },
): string {
  const changed = changes.filter(scenarioChanged);
  const lines = [
    "# Scenario comparison",
    "",
    `Before: ${identities.before}. After: ${identities.after}. ` +
      `${changed.length} of ${changes.length} scenarios changed. ` +
      "Deltas compare the lowest values.",
  ];
  if (changed.length === 0) return `${lines.join("\n")}\n`;
  lines.push("", ...comparisonOverviewTable(changed));
  for (const item of changed) {
    if (!item.before || !item.after || item.routes.length === 0) continue;
    lines.push("", `## ${item.scenario}`, "");
    lines.push(
      ...table(
        ["Route", "Count", "409s", "Request bytes", "Response bytes"],
        item.routes.map((route) => [
          `\`${cell(route.route)}\``,
          delta(route.before.count, route.after.count),
          delta(route.before.conflicts, route.after.conflicts),
          delta(route.before.requestBytes, route.after.requestBytes),
          delta(route.before.responseBytes, route.after.responseBytes),
        ]),
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}
