import { cpus } from "node:os";
import { resolve } from "node:path";
import { sourceIdentity } from "../database/artifacts";
import {
  privateDirectory,
  reportDirectory,
  repositoryRoot,
  saveJson,
  saveReportFile,
} from "../reportFiles";
import { logTail } from "../testProcess";
import { discoverScenarios, type Scenario, selectScenarios } from "./discover";
import { formatScenarioComparison, formatScenarioReport } from "./markdown";
import {
  parseScenarioOptions,
  type ScenarioOptions,
  scenarioUsage,
} from "./options";
import {
  loadScenarioReport,
  type ScenarioReport,
  type ScenarioRun,
  scenarioBoundary,
} from "./report";
import { runScenario, type ScenarioRunInput } from "./run";
import { compareScenarios, summarizeScenarios } from "./summary";

type RunOptions = Extract<ScenarioOptions, { mode: "run" }>;

/** What `perf:scenarios` runs against; tests replace discovery and runner. */
export interface ScenarioHost {
  readonly discover: () => Promise<Scenario[]>;
  readonly runScenario: (input: ScenarioRunInput) => Promise<ScenarioRun>;
  readonly reportDirectory: string;
  readonly print: (text: string) => void;
}

const defaultHost: ScenarioHost = {
  discover: discoverScenarios,
  runScenario,
  reportDirectory,
  print: (text) => console.log(text),
};

function loadReport(path: string): Promise<ScenarioReport> {
  return loadScenarioReport(resolve(repositoryRoot, path));
}

function reportLabel(report: ScenarioReport): string {
  const label = `run ${report.runId} at ${report.revision.slice(0, 12)}`;
  return report.status === "complete" ? label : `${label} (${report.status})`;
}

function compare(before: ScenarioReport, after: ScenarioReport): string {
  return formatScenarioComparison(
    compareScenarios(before.summary, after.summary),
    { before: reportLabel(before), after: reportLabel(after) },
  );
}

function describeRun(run: ScenarioRun): string {
  const base = `${run.scenario} #${run.sample}: ${run.status}, ${(run.wallMs / 1000).toFixed(1)} s`;
  if (!run.http) return base;
  const parts = [
    `${run.http.requests} requests`,
    ...(run.http.truncated ? ["truncated"] : []),
    ...(run.http.conflicts > 0 ? [`${run.http.conflicts} 409s`] : []),
    `${run.http.requestBytes} B sent`,
    `${run.http.responseBytes} B received`,
    ...(run.statements.status === "captured"
      ? [
          `${run.statements.summary.statements} API stmts${run.statements.summary.truncated ? " (truncated)" : ""}`,
        ]
      : []),
    ...(run.clientSql?.status === "captured"
      ? [
          `${run.clientSql.summary.statements} client SQL${run.clientSql.summary.truncated ? " (truncated)" : ""}`,
        ]
      : []),
  ];
  return `${base} (${parts.join(", ")})`;
}

async function measure(
  scenarios: readonly Scenario[],
  options: RunOptions,
  host: ScenarioHost,
): Promise<ScenarioReport> {
  const runId = crypto.randomUUID();
  const logs = await privateDirectory(
    resolve(host.reportDirectory, `scenarios-${runId}`),
  );
  const runs: ScenarioRun[] = [];
  const metadata = {
    schemaVersion: 1,
    scenario: "bob-and-alice-scenarios",
    runId,
    startedAt: new Date().toISOString(),
    ...sourceIdentity(),
    runtime: {
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model ?? null,
    },
    options: {
      scenarios: options.scenarios,
      samples: options.samples,
      statements: options.statements,
      paramHash: options.paramHash,
      clientStatements: options.clientStatements,
      payloadAudit: options.payloadAudit,
      stacks: options.stacks,
    },
    boundary: scenarioBoundary,
  } as const;
  const report = (status: ScenarioReport["status"]): ScenarioReport => ({
    ...metadata,
    updatedAt: new Date().toISOString(),
    status,
    summary: summarizeScenarios(runs),
    runs,
  });
  host.print(
    `${scenarios.length} scenarios, ${options.samples} sample(s) each; logs in ${logs}`,
  );
  for (let sample = 1; sample <= options.samples; sample += 1) {
    for (const scenario of scenarios) {
      const name = `${scenario.name}-${sample}`;
      const run = await host.runScenario({
        scenario,
        sample,
        log: resolve(logs, `${name}.log`),
        httpCapture: resolve(logs, `${name}.http.jsonl`),
        ...(options.statements && {
          statements: {
            out: resolve(logs, `${name}.statements.jsonl`),
            paramHash: options.paramHash,
          },
        }),
        ...(options.clientStatements && {
          clientSql: {
            out: resolve(logs, `${name}.client-sql.jsonl`),
          },
        }),
        ...(options.payloadAudit && {
          payloadAudit: {
            out: resolve(logs, `${name}.payloads.jsonl`),
            stacks: options.stacks,
          },
        }),
      });
      runs.push(run);
      host.print(describeRun(run));
      if (run.status !== "passed") host.print(await logTail(run.log));
      await saveJson(
        `scenarios-${runId}.json`,
        report("running"),
        host.reportDirectory,
      );
    }
  }
  return report(
    runs.every((run) => run.status === "passed") ? "complete" : "failed",
  );
}

/**
 * `perf:scenarios`: compares two saved reports, or profiles bob-and-alice
 * scenarios and saves JSON and Markdown reports. Exits 1 on any failure.
 */
export async function runScenarioCommand(
  args: string[],
  host = defaultHost,
): Promise<number> {
  const options = parseScenarioOptions(args);
  if (!options) {
    host.print(scenarioUsage);
    return 0;
  }
  if (options.mode === "compare") {
    const [before, after] = await Promise.all([
      loadReport(options.before),
      loadReport(options.after),
    ]);
    host.print(compare(before, after));
    return 0;
  }
  const baseline = options.baseline ? await loadReport(options.baseline) : null;
  const scenarios = selectScenarios(await host.discover(), options.scenarios);
  const final = await measure(scenarios, options, host);
  const jsonPath = await saveJson(
    `scenarios-${final.runId}.json`,
    final,
    host.reportDirectory,
  );
  const comparison = baseline ? compare(baseline, final) : null;
  const markdownPath = await saveReportFile(
    `scenarios-${final.runId}.md`,
    [formatScenarioReport(final), comparison].filter(Boolean).join("\n"),
    host.reportDirectory,
  );
  if (comparison) host.print(`\n${comparison}`);
  host.print(`Report: ${jsonPath}\nMarkdown: ${markdownPath}`);
  return final.status === "complete" ? 0 : 1;
}
