import type { StatementCount, StatementSummary } from "./summary";

const integers = new Intl.NumberFormat("en-US");
const maxSqlLength = 240;

function sqlCell(sql: string): string {
  const short =
    sql.length > maxSqlLength ? `${sql.slice(0, maxSqlLength)}…` : sql;
  return `\`${short.replaceAll("`", "'").replaceAll("|", "\\|")}\``;
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|");
}

function statementTable(
  countHeading: string,
  counts: readonly StatementCount[],
): string[] {
  return [
    `| ${countHeading} | Statement |`,
    "| ---: | --- |",
    ...counts.map(
      ({ sql, count }) => `| ${integers.format(count)} | ${sqlCell(sql)} |`,
    ),
  ];
}

/** A capture summary as Markdown, after `intro`. */
export function formatStatementSummary(
  summary: StatementSummary,
  intro: string,
): string {
  const lines = [
    "# Statement capture",
    "",
    intro,
    `${integers.format(summary.statements)} statements.`,
  ];
  if (summary.truncated)
    lines.push(
      "",
      "The capture stopped at its record limit: every count is a lower bound.",
    );
  if (summary.phases.length > 0)
    lines.push(
      "",
      "## Phases",
      "",
      "Each phase counts the statements since the previous phase ended, so the first phase includes the setup before it.",
      "",
      "| Phase | Requests | Statements | Per request |",
      "| --- | ---: | ---: | ---: |",
      ...summary.phases.map(
        (phase) =>
          `| ${cell(phase.label)} | ${phase.requests} | ${integers.format(phase.statements)} | ${phase.requests === 0 ? "" : (phase.statements / phase.requests).toFixed(1)} |`,
      ),
    );
  lines.push(
    "",
    "## Labels",
    "",
    "Requests counts the request scopes the statements ran in.",
    "",
    "| Label | Statements | Requests |",
    "| --- | ---: | ---: |",
    ...summary.labels.map(
      (label) =>
        `| ${cell(label.label)} | ${integers.format(label.statements)} | ${integers.format(label.requestScopes)} |`,
    ),
    "",
    "## Most repeated statements",
    "",
    ...statementTable("Count", summary.top),
  );
  const repeats = summary.labels.flatMap((label) =>
    (label.sameKeyRepeats ?? []).map((repeat) => ({ ...repeat, label })),
  );
  if (summary.paramHashes)
    lines.push(
      "",
      "## Same-key repeats",
      "",
      "Statements sent again with the same bind values within one request (or under one label, outside every request); the count is the extra sends.",
      "",
      ...(repeats.length === 0
        ? ["None."]
        : [
            "| Label | Extra | Statement |",
            "| --- | ---: | --- |",
            ...repeats
              .sort((a, b) => b.count - a.count)
              .slice(0, 20)
              .map(
                (repeat) =>
                  `| ${cell(repeat.label.label)} | ${repeat.count} | ${sqlCell(repeat.sql)} |`,
              ),
          ]),
    );
  return `${lines.join("\n")}\n`;
}
