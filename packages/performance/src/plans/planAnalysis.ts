/**
 * Pure parser and Markdown formatter for PostgreSQL `EXPLAIN (GENERIC_PLAN,
 * FORMAT JSON)` output over top normalized queries from a statement capture.
 */

export interface PlanWarning {
  readonly kind: "Seq Scan" | "Sort" | "Materialize";
  readonly relation?: string;
}

export interface AnalyzedQueryPlan {
  readonly sql: string;
  readonly count: number;
  readonly status: "planned" | "skipped";
  readonly nodeTypes: readonly string[];
  readonly warnings: readonly PlanWarning[];
  readonly error?: string;
}

export interface PlanReportSummary {
  readonly inspected: number;
  readonly planned: number;
  readonly skipped: number;
  readonly seqScanQueries: number;
  readonly sortQueries: number;
  readonly plans: readonly AnalyzedQueryPlan[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rewrites `normalizeSql`'s collapsed `$n, …` placeholder lists back into a
 * single positional parameter so PostgreSQL `EXPLAIN (GENERIC_PLAN)` can parse
 * the statement cleanly.
 */
export function prepareSqlForGenericPlan(normalizedSql: string): string {
  let nextParam = 0;
  for (const match of normalizedSql.matchAll(/\$(\d+)/gu)) {
    const n = Number(match[1]);
    if (n > nextParam) nextParam = n;
  }
  return normalizedSql.replace(/\$n,\s*…/gu, () => {
    nextParam += 1;
    return `$${nextParam}`;
  });
}

function walkPlanNode(
  node: unknown,
  nodeTypes: Set<string>,
  warnings: PlanWarning[],
): void {
  if (!isRecord(node)) return;
  const nodeType = Reflect.get(node, "Node Type");
  const relation = Reflect.get(node, "Relation Name");
  if (typeof nodeType === "string") {
    nodeTypes.add(nodeType);
    if (
      nodeType === "Seq Scan" ||
      nodeType === "Sort" ||
      nodeType === "Materialize"
    ) {
      warnings.push({
        kind: nodeType,
        ...(typeof relation === "string" ? { relation } : {}),
      });
    }
  }
  const children = Reflect.get(node, "Plans");
  if (Array.isArray(children)) {
    for (const child of children) walkPlanNode(child, nodeTypes, warnings);
  }
}

/** Extracts node types and scan/sort warnings from Postgres JSON EXPLAIN output. */
export function analyzeExplainJson(explainJson: unknown): {
  readonly nodeTypes: readonly string[];
  readonly warnings: readonly PlanWarning[];
} {
  const nodeTypes = new Set<string>();
  const warnings: PlanWarning[] = [];
  const entries = Array.isArray(explainJson) ? explainJson : [explainJson];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    walkPlanNode(Reflect.get(entry, "Plan") ?? entry, nodeTypes, warnings);
  }
  return { nodeTypes: [...nodeTypes], warnings };
}

export function summarizePlans(
  plans: readonly AnalyzedQueryPlan[],
): PlanReportSummary {
  let planned = 0;
  let skipped = 0;
  let seqScanQueries = 0;
  let sortQueries = 0;
  for (const plan of plans) {
    if (plan.status === "planned") planned += 1;
    else skipped += 1;
    if (plan.warnings.some((w) => w.kind === "Seq Scan")) seqScanQueries += 1;
    if (plan.warnings.some((w) => w.kind === "Sort")) sortQueries += 1;
  }
  return {
    inspected: plans.length,
    planned,
    skipped,
    seqScanQueries,
    sortQueries,
    plans,
  };
}

const integers = new Intl.NumberFormat("en-US");

function sqlCell(sql: string): string {
  const short = sql.length > 160 ? `${sql.slice(0, 160)}…` : sql;
  return `\`${short.replaceAll("`", "'").replaceAll("|", "\\|")}\``;
}

function formatWarnings(plan: AnalyzedQueryPlan): string {
  if (plan.status === "skipped") return `skipped (${plan.error ?? "error"})`;
  if (plan.warnings.length === 0) return "ok";
  return plan.warnings
    .map((w) => (w.relation ? `${w.kind} (${w.relation})` : w.kind))
    .join(", ");
}

/** Renders a `perf:plans` summary as Markdown. */
export function formatPlanSummaryMarkdown(
  summary: PlanReportSummary,
  intro: string,
): string {
  const lines = [
    "# PostgreSQL query plan audit",
    "",
    intro,
    `Inspected ${integers.format(summary.inspected)} queries ` +
      `(${integers.format(summary.planned)} planned, ${integers.format(summary.skipped)} skipped; ` +
      `${integers.format(summary.seqScanQueries)} with Seq Scan, ${integers.format(summary.sortQueries)} with Sort).`,
    "",
    "| Count | Warnings | Nodes | Statement |",
    "| ---: | --- | --- | --- |",
    ...summary.plans.map(
      (plan) =>
        `| ${integers.format(plan.count)} | ${formatWarnings(plan).replaceAll("|", "\\|")} | ${plan.nodeTypes.join(", ").replaceAll("|", "\\|")} | ${sqlCell(plan.sql)} |`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}
