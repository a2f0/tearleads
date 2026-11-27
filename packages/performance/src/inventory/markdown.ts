import type { CanaryBudgetInventory } from "./canaryBudgets";
import type { DuplicateIndexLead } from "./indexes";
import type { OpenApiInventory } from "./openapiInventory";
import type { PostgresSchemaInventory } from "./postgresSchema";
import type { SqliteSchemaInventory } from "./sqliteSchema";

export interface InventoryReport {
  readonly schemaVersion: 1;
  readonly scenario: "static-inventory";
  readonly generatedAt: string;
  readonly revision: string;
  readonly dirty: boolean;
  readonly postgres: PostgresSchemaInventory;
  readonly sqlite: SqliteSchemaInventory;
  readonly openapi: OpenApiInventory;
  readonly canaries: CanaryBudgetInventory;
}

function formatDuplicateSection(
  heading: string,
  leads: readonly DuplicateIndexLead[],
): string[] {
  const lines = [`### ${heading} (${leads.length})`];
  if (leads.length === 0) {
    lines.push("None detected.");
    return lines;
  }
  lines.push("| Table | Index | Columns | Covered By | Reason |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const lead of leads) {
    lines.push(
      `| \`${lead.table}\` | \`${lead.indexName}\` | \`(${lead.indexColumns.join(", ")})\` | \`${lead.coveredByName}\` (\`${lead.coveredByColumns.join(", ")}\`) | ${lead.reason} |`,
    );
  }
  return lines;
}

function formatUnreadList(
  heading: string,
  items: readonly string[],
  limit = 25,
): string[] {
  const lines = [`### ${heading} (${items.length})`];
  if (items.length === 0) {
    lines.push("None detected.");
    return lines;
  }
  for (const item of items.slice(0, limit)) {
    lines.push(`- ${item}`);
  }
  if (items.length > limit) {
    lines.push(`- ... and ${items.length - limit} more (see JSON report)`);
  }
  return lines;
}

function formatMethodSummary(
  byMethod: Readonly<Record<string, number>>,
): string {
  return Object.entries(byMethod)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([method, count]) => `${method}: ${count}`)
    .join(", ");
}

function formatDriftSection(canaries: CanaryBudgetInventory): string[] {
  const lines = [
    `## Canary Budget Ceilings (${canaries.budgetAssertionCount} assertions)`,
  ];
  if (canaries.driftSource === undefined) {
    lines.push(
      "Pass `--canaries <report.json>` to compare declared ceilings against a saved `perf:canaries` run.",
    );
    return lines;
  }
  if (canaries.ceilingDrift.length === 0) {
    lines.push(
      `No ceiling headroom drift detected against \`${canaries.driftSource}\`.`,
    );
    return lines;
  }
  lines.push(`Compared against \`${canaries.driftSource}\`:`);
  lines.push("| Canary | Phase | Measured | Ceiling | Headroom |");
  lines.push("| --- | --- | ---: | ---: | ---: |");
  for (const item of canaries.ceilingDrift) {
    lines.push(
      `| ${item.canary} | ${item.phase} | ${item.measuredTotal} | ${item.ceilingTotal} | +${item.headroom} |`,
    );
  }
  return lines;
}

export function formatInventoryMarkdown(report: InventoryReport): string {
  const { postgres, sqlite, openapi, canaries } = report;
  const lines: string[] = [
    "# Static Protocol & Database Inventory",
    "",
    `- Revision: \`${report.revision}\`${report.dirty ? " (dirty)" : ""}`,
    `- Generated: ${report.generatedAt}`,
    "",
    "## Compactness Scorecard",
    "",
    "| Surface | Count | Details |",
    "| --- | ---: | --- |",
    `| API Postgres tables | ${postgres.tableCount} | ${postgres.columnCount} columns, ${postgres.indexCount} indexes (${postgres.migrationCount} migrations) |`,
    `| Client SQLite tables | ${sqlite.totalTableCount} | ${sqlite.sdkTableCount} SDK + ${sqlite.appProjectionTableCount} app projections, ${sqlite.columnCount} columns, ${sqlite.indexCount} indexes |`,
    `| OpenAPI operations | ${openapi.operationCount} | ${openapi.pathCount} paths (${formatMethodSummary(openapi.byMethod)}) |`,
    `| OpenAPI 2xx response fields | ${openapi.distinctResponseFields} | ${openapi.unreadResponseFields.length} unreferenced lead(s) in client/app/cli source |`,
    `| Canary budget assertions | ${canaries.budgetAssertionCount} | ${canaries.ceilingDrift.length} drifted phase ceiling(s) |`,
    "",
    "## Index Hygiene Leads",
    "",
    ...formatDuplicateSection(
      "API Postgres Left-Prefix Duplicate Indexes",
      postgres.duplicateIndexes,
    ),
    "",
    ...formatDuplicateSection(
      "Client SQLite Left-Prefix Duplicate Indexes",
      sqlite.duplicateIndexes,
    ),
    "",
    "## Zero-Reader Static Leads",
    "",
    ...formatUnreadList(
      "API Postgres Unreferenced Tables",
      postgres.unreadTables.map((name) => `\`${name}\``),
    ),
    "",
    ...formatUnreadList(
      "API Postgres Unreferenced Columns",
      postgres.unreadColumns.map(
        (col) =>
          `\`${col.table}.${col.sqlColumn}\`${col.propertyName ? ` (\`${col.propertyName}\`)` : ""}`,
      ),
    ),
    "",
    ...formatUnreadList(
      "Client SQLite Unreferenced Tables",
      sqlite.unreadTables.map((name) => `\`${name}\``),
    ),
    "",
    ...formatUnreadList(
      "Client SQLite Unreferenced Columns",
      sqlite.unreadColumns.map(
        (col) =>
          `\`${col.table}.${col.sqlColumn}\` (\`${col.propertyName}\`, ${col.scope})`,
      ),
    ),
    "",
    ...formatUnreadList(
      "OpenAPI Unreferenced 2xx Response Fields",
      openapi.unreadResponseFields.map(
        (entry) => `\`${entry.field}\` (${entry.routes.join(", ")})`,
      ),
    ),
    "",
    ...formatDriftSection(canaries),
    "",
  ];
  return lines.join("\n");
}
