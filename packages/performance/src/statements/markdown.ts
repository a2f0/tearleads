import type {
  RouteStatementSummary,
  StatementCount,
  StatementGroup,
  StatementSummary,
} from "./summary";

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

function routeTable(
  routes: readonly RouteStatementSummary[],
  paramHashes: boolean,
): string[] {
  const header = [
    "Route",
    "Requests",
    "Statements",
    "Per req",
    "Max",
    "In tx",
    "Lock-hold",
    ...(paramHashes ? ["Pure repeats", "All repeats"] : []),
  ];
  const align = header.map((_, index) => (index === 0 ? "---" : "---:"));
  return [
    `| ${header.join(" | ")} |`,
    `| ${align.join(" | ")} |`,
    ...routes.map((route) => {
      const cells = [
        `\`${cell(route.route)}\``,
        integers.format(route.requests),
        integers.format(route.statements),
        route.requests === 0
          ? ""
          : (route.statements / route.requests).toFixed(1),
        integers.format(route.maxPerRequest),
        integers.format(route.txStatements),
        integers.format(route.lockHoldStatements),
        ...(paramHashes
          ? [
              integers.format(route.pureReadRepeats ?? 0),
              integers.format(route.sameKeyRepeats ?? 0),
            ]
          : []),
      ];
      return `| ${cells.join(" | ")} |`;
    }),
  ];
}

function repeatSection(
  heading: string,
  description: string,
  rows: readonly {
    readonly label: StatementGroup;
    readonly sql: string;
    readonly count: number;
  }[],
  emptyText?: string,
): string[] {
  if (rows.length === 0) {
    return emptyText === undefined
      ? []
      : ["", heading, "", description, "", emptyText];
  }
  return [
    "",
    heading,
    "",
    description,
    "",
    "| Label | Extra | Statement |",
    "| --- | ---: | --- |",
    ...[...rows]
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
      .map(
        (repeat) =>
          `| ${cell(repeat.label.label)} | ${repeat.count} | ${sqlCell(repeat.sql)} |`,
      ),
  ];
}

function phaseSection(summary: StatementSummary): string[] {
  if (summary.phases.length === 0) return [];
  const hasExact = summary.phases.some((phase) => phase.exactWindow);
  return [
    "",
    "## Phases",
    "",
    hasExact
      ? "Phases with a start marker count only their own window; earlier phases count statements since the previous phase ended."
      : "Each phase counts the statements since the previous phase ended, so the first phase includes the setup before it.",
    "",
    "| Phase | Requests | Statements | Per request |",
    "| --- | ---: | ---: | ---: |",
    ...summary.phases.map(
      (phase) =>
        `| ${cell(phase.label)} | ${phase.requests} | ${integers.format(phase.statements)} | ${phase.requests === 0 ? "" : (phase.statements / phase.requests).toFixed(1)} |`,
    ),
  ];
}

/** A capture summary as Markdown, after `intro`. */
export function formatStatementSummary(
  summary: StatementSummary,
  intro: string,
): string {
  const txSummary =
    summary.transactions > 0
      ? ` (${integers.format(summary.txStatements)} in ${integers.format(summary.transactions)} transactions, ${integers.format(summary.lockHoldStatements)} under locks).`
      : ".";
  const lines = [
    "# Statement capture",
    "",
    intro,
    `${integers.format(summary.statements)} statements${txSummary}`,
  ];
  if (summary.truncated)
    lines.push(
      "",
      "The capture stopped at its record limit: every count is a lower bound.",
    );
  if (summary.routes.length > 0)
    lines.push(
      "",
      "## By route",
      "",
      "Requests, total statements, serial statements inside transactions, statements after an explicit lock, and repeated same-key reads per route template.",
      "",
      ...routeTable(summary.routes, summary.paramHashes),
    );
  lines.push(
    ...phaseSection(summary),
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
  if (summary.paramHashes) {
    const repeats = summary.labels.flatMap((label) =>
      (label.sameKeyRepeats ?? []).map((repeat) => ({ ...repeat, label })),
    );
    const pureRepeats = summary.labels.flatMap((label) =>
      (label.pureReadRepeats ?? []).map((repeat) => ({ ...repeat, label })),
    );
    lines.push(
      ...repeatSection(
        "## Same-key repeats",
        "Statements sent again with the same bind values within one request (or under one label, outside every request); the count is the extra sends.",
        repeats,
        "None.",
      ),
      ...repeatSection(
        "## Pure read repeats (no intervening write)",
        "Same-key SELECT repeats where no INSERT, UPDATE, or DELETE touched any referenced table in between.",
        pureRepeats,
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}
