import { resolve } from "node:path";
import {
  createPostgresPoolConfig,
  PostgresPool,
} from "@tearleads/api-shared/postgres-transport";
import { sourceIdentity } from "../database/artifacts";
import { parseLocalDatabaseUrl } from "../inProcess/postgresProxy";
import {
  privateDirectory,
  reportDirectory,
  repositoryRoot,
  saveJson,
  saveReportFile,
} from "../reportFiles";
import { readCaptureFile } from "../statements/captureFile";
import { isReadOnlySelect } from "../statements/sqlAnalysis";
import { parseCapture, summarizeCapture } from "../statements/summary";
import { parsePlanOptions, planUsage } from "./options";
import {
  type AnalyzedQueryPlan,
  analyzeExplainJson,
  formatPlanSummaryMarkdown,
  prepareSqlForGenericPlan,
  summarizePlans,
} from "./planAnalysis";

export interface PlanHost {
  readonly reportDirectory: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly explain: (
    databaseUrl: string,
    queries: readonly { readonly sql: string; readonly count: number }[],
    disableSeqScan: boolean,
  ) => Promise<AnalyzedQueryPlan[]>;
  readonly print: (text: string) => void;
}

async function explainOne(
  pool: PostgresPool,
  entry: { readonly sql: string; readonly count: number },
  disableSeqScan: boolean,
): Promise<AnalyzedQueryPlan> {
  const prepared = prepareSqlForGenericPlan(entry.sql);
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    if (disableSeqScan) {
      await client.query("SET LOCAL enable_seqscan = off");
    }
    const result = await client.query(
      `EXPLAIN (GENERIC_PLAN, FORMAT JSON) ${prepared}`,
    );
    await client.query("ROLLBACK");
    const first: unknown = result.rows[0];
    const planJson =
      typeof first === "object" && first !== null
        ? Reflect.get(first, "QUERY PLAN")
        : null;
    const analyzed = analyzeExplainJson(planJson);
    return {
      sql: entry.sql,
      count: entry.count,
      status: "planned",
      nodeTypes: analyzed.nodeTypes,
      warnings: analyzed.warnings,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return {
      sql: entry.sql,
      count: entry.count,
      status: "skipped",
      nodeTypes: [],
      warnings: [],
      error:
        (error instanceof Error ? error.message.split("\n")[0] : undefined) ??
        "failed",
    };
  } finally {
    client.release();
  }
}

async function explainOnLocalPostgres(
  databaseUrl: string,
  queries: readonly { readonly sql: string; readonly count: number }[],
  disableSeqScan: boolean,
): Promise<AnalyzedQueryPlan[]> {
  Object.assign(process.env, {
    API_DATABASE: "postgres",
    DATABASE_URL: databaseUrl,
  });
  const api = await import("@tearleads/api/test-runtime");
  await api.initializeApiDatabase();
  const pool = new PostgresPool(
    createPostgresPoolConfig({ DATABASE_URL: databaseUrl }),
  );
  try {
    const results: AnalyzedQueryPlan[] = [];
    for (const entry of queries) {
      results.push(await explainOne(pool, entry, disableSeqScan));
    }
    return results;
  } finally {
    await pool.end();
  }
}

const defaultHost: PlanHost = {
  reportDirectory,
  env: process.env,
  explain: explainOnLocalPostgres,
  print: (text) => console.log(text),
};

export async function runPlanCommand(
  args: readonly string[],
  host = defaultHost,
): Promise<number> {
  const options = parsePlanOptions(args);
  if (!options) {
    host.print(planUsage);
    return 0;
  }
  const { DATABASE_URL: databaseUrl } = host.env;
  parseLocalDatabaseUrl(databaseUrl);
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const capturePath = resolve(repositoryRoot, options.capture);
  const rawCapture = await readCaptureFile(capturePath);
  if (rawCapture === null) {
    throw new Error(`There is no capture at ${capturePath}.`);
  }
  const summary = summarizeCapture(parseCapture(rawCapture), options.limit * 3);
  const selects = summary.top
    .filter((entry) => isReadOnlySelect(entry.sql))
    .slice(0, options.limit);
  const plans = await host.explain(
    databaseUrl,
    selects,
    options.disableSeqScan,
  );
  const report = summarizePlans(plans);
  const source = sourceIdentity();
  const runId = crypto.randomUUID();
  const dir = await privateDirectory(host.reportDirectory);
  const jsonPath = await saveJson(
    `plans-${runId}.json`,
    {
      schemaVersion: 1,
      scenario: "postgres-query-plans",
      runId,
      ...source,
      options,
      capture: capturePath,
      summary: report,
    },
    dir,
  );
  const markdown = formatPlanSummaryMarkdown(
    report,
    `Capture ${capturePath}, at \`${source.revision}\`${source.dirty ? " with uncommitted changes" : ""}${options.disableSeqScan ? " (enable_seqscan = off)" : ""}.`,
  );
  const mdPath = await saveReportFile(`plans-${runId}.md`, markdown, dir);
  host.print(markdown);
  host.print(`Report: ${jsonPath}\nMarkdown: ${mdPath}`);
  return 0;
}
