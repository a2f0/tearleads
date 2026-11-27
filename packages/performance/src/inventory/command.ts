import { resolve } from "node:path";
import { sourceIdentity } from "../database/artifacts";
import {
  reportDirectory,
  repositoryRoot,
  saveJson,
  saveReportFile,
} from "../reportFiles";
import { auditCanaryBudgets } from "./canaryBudgets";
import { formatInventoryMarkdown, type InventoryReport } from "./markdown";
import { auditOpenApi } from "./openapiInventory";
import { inventoryUsage, parseInventoryOptions } from "./options";
import { auditPostgresSchema } from "./postgresSchema";
import { auditSqliteSchema } from "./sqliteSchema";

export interface InventoryHost {
  readonly repoRoot: string;
  readonly reportDirectory: string;
  readonly print: (text: string) => void;
}

const defaultHost: InventoryHost = {
  repoRoot: repositoryRoot,
  reportDirectory,
  print: (text) => console.log(text),
};

async function buildInventoryReport(
  repoRoot: string,
  canariesReportPath?: string,
): Promise<InventoryReport> {
  const [source, postgres, sqlite, openapi, canaries] = await Promise.all([
    sourceIdentity(),
    auditPostgresSchema(repoRoot),
    auditSqliteSchema(repoRoot),
    auditOpenApi(repoRoot),
    auditCanaryBudgets(repoRoot, canariesReportPath),
  ]);
  return {
    schemaVersion: 1,
    scenario: "static-inventory",
    generatedAt: new Date().toISOString(),
    revision: source.revision,
    dirty: source.dirty,
    postgres,
    sqlite,
    openapi,
    canaries,
  };
}

export async function runInventoryCommand(
  args: readonly string[],
  host = defaultHost,
): Promise<number> {
  const options = parseInventoryOptions(args);
  if (options === null) {
    host.print(inventoryUsage);
    return 0;
  }
  const canariesPath =
    options.canariesReport !== undefined
      ? resolve(host.repoRoot, options.canariesReport)
      : undefined;
  const report = await buildInventoryReport(host.repoRoot, canariesPath);
  const stamp = report.generatedAt.replaceAll(":", "-").replaceAll(".", "-");
  const baseName = `inventory-${stamp}`;
  const jsonPath = await saveJson(
    `${baseName}.json`,
    report,
    host.reportDirectory,
  );
  const markdown = formatInventoryMarkdown(report);
  const mdPath = await saveReportFile(
    `${baseName}.md`,
    markdown,
    host.reportDirectory,
  );

  if (options.json) {
    host.print(JSON.stringify(report, null, 2));
  } else {
    host.print(markdown);
    host.print(`Saved JSON: ${jsonPath}`);
    host.print(`Saved Markdown: ${mdPath}`);
  }
  return 0;
}
